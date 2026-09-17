/**
 * Tagging worker — consumes jobs from src/queues/taggingQueue.js.
 *
 * Run as its own process: `npm run worker` (see package.json). Kept
 * separate from the API process on purpose, matching PRD §6.2's "worker
 * pools separated from the API pool" — bursty vision-API calls shouldn't
 * compete with request latency, and doing this now avoids a refactor
 * later when Phase 5 actually scales it out.
 *
 * For local dev, running `npm run dev` (API) and `npm run worker`
 * (this file) in two terminals is enough — Bull doesn't care how many
 * processes call .process(), so this also scales horizontally later by
 * just running more worker processes against the same Redis.
 */

require('dotenv').config();
const axios = require('axios');
const redis = require('redis');
const { Op, fn, col } = require('sequelize');

const logger = require('../utils/logger');
const { Clothes, UserInteraction } = require('../database/models');
const { taggingQueue } = require('../queues/taggingQueue');
const { MCPFashionTagger, MCPConfig, VisionProvider } = require('../services/fashionTagger');
// Phase 2: the nightly preference-learning job and the daily check-in
// email job both run in this same process for now, alongside tagging.
// Volume for both is low (once/day each, DB-only or a handful of
// emails) so a dedicated process per job type would just be more things
// to deploy and keep running for no real benefit yet -- split them out
// once either one's workload actually grows enough to compete with
// tagging for this process's resources.
const { preferenceLearningQueue, ACTIVE_WINDOW_DAYS, NIGHTLY_CONCURRENCY } = require('../queues/preferenceLearningQueue');
const { checkInQueue, processDailyCheckIn } = require('../queues/checkInQueue');
const { aiOutfitService } = require('../services/AIOutfit recommendation');

const CONCURRENCY = parseInt(process.env.TAGGING_WORKER_CONCURRENCY || '3', 10);

let fashionTaggerInstance = null;
function getFashionTagger() {
  if (!fashionTaggerInstance) {
    const config = new MCPConfig({
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
      redisHost: process.env.REDIS_CLOUD_HOST,
      redisPort: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
      redisPassword: process.env.REDIS_CLOUD_PASSWORD,
      redisUseSSL: process.env.REDIS_TLS === 'true', // see REDIS_TLS note above
      useCache: true,
      cacheTTL: 86400,
      primaryProvider: VisionProvider.ANTHROPIC_CLAUDE,
      fallbackProviders: [VisionProvider.OPENAI_GPT4, VisionProvider.GOOGLE_VISION],
    });
    fashionTaggerInstance = new MCPFashionTagger(config);
  }
  return fashionTaggerInstance;
}

let cacheClient = null;
async function getCacheClient() {
  if (!cacheClient) {
    cacheClient = redis.createClient({
      socket: {
        host: process.env.REDIS_CLOUD_HOST || 'localhost',
        port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
        // TLS is an explicit opt-in (REDIS_TLS=true), not inferred from
                // REDIS_CLOUD_HOST merely being set (that's set in every real
                // environment, including plain local dev Redis) — the old
                // inference forced a TLS handshake against a non-TLS local
                // Redis, which just hangs/retries forever rather than
                // failing, stalling every request that touches the cache.
                tls: process.env.REDIS_TLS === 'true',
        rejectUnauthorized: false,
      },
      password: process.env.REDIS_CLOUD_PASSWORD,
    });
    cacheClient.on('error', (err) => logger.error('Worker cache error', { message: err.message }));
    await cacheClient.connect();
  }
  return cacheClient;
}

async function invalidateUserClothesCache(userId) {
  try {
    const cache = await getCacheClient();
    const keys = await cache.keys(`clothes:user:${userId}:*`);
    if (keys.length > 0) await cache.del(keys);
  } catch (error) {
    logger.warn('Worker cache invalidation failed', { message: error.message });
  }
}

async function downloadImage(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  return Buffer.from(response.data);
}

async function processTaggingJob(job) {
  const { clothesId, userId, imageUrl, mode } = job.data;
  logger.info('Processing tagging job', { jobId: job.id, clothesId, mode });

  const item = await Clothes.findByPk(clothesId);
  if (!item) {
    logger.warn('Tagging job skipped — clothes item no longer exists', { clothesId });
    return { skipped: true };
  }

  // Phase 1 fix: everything below used to run with no try/catch of its
  // own. `tagger.tagClothing()` failing cleanly (taggingResult.success
  // === false) was handled -- but downloadImage() throwing (bad/expired
  // image URL, Cloudinary hiccup, plain network failure -- realistically
  // the MOST common failure mode, more so than the vision API itself
  // erroring) threw straight out of this function with the item never
  // touched. Bull would retry and eventually mark the *job* failed, but
  // the *clothes row* stayed at aiMetadata.status: 'queued' forever --
  // invisible to GET /clothes/review/needed/:userId, with
  // needsManualReview still false, so the user never found out tagging
  // never finished. Wrapping the whole thing means ANY failure here now
  // lands the item in the same reviewable "failed" state, regardless of
  // which step it came from.
  try {
    const imageBuffer = await downloadImage(imageUrl);
    const tagger = getFashionTagger();
    const taggingResult = await tagger.tagClothing(imageBuffer, userId, clothesId);

    if (!taggingResult.success) {
      throw new Error(taggingResult.error || 'Tagging failed');
    }

    const meta = taggingResult.metadata;
    const tags = [
      meta.clothingCategory,
      meta.pattern,
      meta.formality,
      ...(Array.isArray(meta.color) ? meta.color : []),
      ...(Array.isArray(meta.fabric) ? meta.fabric : []),
    ].filter(Boolean);

    await item.update({
      type: meta.clothingCategory?.trim() || item.type,
      color: (Array.isArray(meta.color) ? meta.color[0] : meta.color)?.trim(),
      pattern: meta.pattern?.trim(),
      fabric: (Array.isArray(meta.fabric) ? meta.fabric[0] : meta.fabric)?.trim(),
      season: Array.isArray(meta.season) ? meta.season.join(', ') : meta.season,
      occasion: Array.isArray(meta.occasion) ? meta.occasion.join(', ') : meta.occasion,
      brand: meta.brand,
      tags,
      aiGeneratedTags: true,
      aiConfidenceScore: meta.confidenceScore,
      needsManualReview: (meta.confidenceScore ?? 1) < 0.6,
      aiMetadata: {
        status: 'complete',
        confidence: meta.confidenceScore,
        provider: taggingResult.providerUsed,
        cached: taggingResult.cached,
        mode,
        taggedAt: new Date().toISOString(),
      },
    });

    await invalidateUserClothesCache(userId);

    logger.info('Tagging job complete', { jobId: job.id, clothesId, confidence: meta.confidenceScore });
    return { success: true };

  } catch (error) {
    // Marked as failed/reviewable on every attempt, not just the last
    // one -- if a later retry succeeds, the success branch above
    // overwrites this with the 'complete' state anyway, and in the
    // meantime the item is visible in the review queue rather than
    // silently stuck for however long the retries take.
    await item.update({
      needsManualReview: true,
      aiMetadata: {
        status: 'failed',
        error: error.message,
        mode,
        attemptedAt: new Date().toISOString(),
      },
    });
    await invalidateUserClothesCache(userId);
    throw error;
  }
}

taggingQueue.process(CONCURRENCY, processTaggingJob);
logger.info(`Tagging worker started (concurrency: ${CONCURRENCY})`);

// ============================================================================
// Phase 2: preference-learning jobs
// ============================================================================

/** Runs `items` through `handler` with at most `limit` in flight at once. */
async function runWithConcurrency(items, limit, handler) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.allSettled(chunk.map(handler));
    results.push(...chunkResults);
  }
  return results;
}

preferenceLearningQueue.process('learn-one', 2, async (job) => {
  const { userId, reason } = job.data;
  logger.info('Learning preferences for one user', { jobId: job.id, userId, reason });
  await aiOutfitService.preferenceLearner.learnUserPreferences(userId);
  return { success: true };
});

preferenceLearningQueue.process('nightly-learn-all', 1, async (job) => {
  const windowStart = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // "Active" = logged at least one interaction in the window -- keeps
  // this nightly pass proportional to real usage instead of scanning
  // every account that ever signed up.
  const rows = await UserInteraction.findAll({
    where: { createdAt: { [Op.gte]: windowStart } },
    attributes: [[fn('DISTINCT', col('user_id')), 'userId']],
    raw: true,
  });
  const activeUserIds = rows.map((r) => r.userId).filter(Boolean);

  logger.info('Nightly preference-learning run starting', {
    jobId: job.id,
    activeUserCount: activeUserIds.length,
    windowDays: ACTIVE_WINDOW_DAYS,
    concurrency: NIGHTLY_CONCURRENCY,
  });

  const results = await runWithConcurrency(activeUserIds, NIGHTLY_CONCURRENCY, async (userId) => {
    try {
      await aiOutfitService.preferenceLearner.learnUserPreferences(userId);
    } catch (error) {
      // One user's bad data (or a transient DB hiccup) shouldn't stop
      // the rest of the run -- logged and skipped, not thrown.
      logger.warn('Nightly preference learning failed for one user', { userId, error: error.message });
      throw error; // still marks this settle() as rejected for the summary count below
    }
  });

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  logger.info('Nightly preference-learning run complete', { succeeded, failed, total: activeUserIds.length });

  return { succeeded, failed, total: activeUserIds.length };
});

logger.info('Preference-learning processors started (learn-one concurrency: 2, nightly-learn-all concurrency: 1)');

// ============================================================================
// Phase 2: daily check-in job
// ============================================================================

checkInQueue.process('daily-checkin-run', 1, async (job) => {
  logger.info('Daily check-in run starting', { jobId: job.id });
  return await processDailyCheckIn();
});

logger.info('Daily check-in processor started');

process.on('SIGTERM', async () => {
  await taggingQueue.close();
  await preferenceLearningQueue.close();
  await checkInQueue.close();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await taggingQueue.close();
  await preferenceLearningQueue.close();
  await checkInQueue.close();
  process.exit(0);
});
