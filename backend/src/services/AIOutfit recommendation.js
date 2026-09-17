// ============================================================================
// AI/ML OUTFIT RECOMMENDATION ENGINE - COMPLETE WITH TRIP MODE INTEGRATION
// ============================================================================
// Production-ready outfit recommendation service with trip mode detection
// Integrates seamlessly with trip packing system
// ============================================================================

const {
    Clothes,
    User,
    Outfit,
    UserPreferences,
    UserInteraction,
    OutfitRating,
    ClothesAttributes,
    RecommendationLog,
    FashionTrends,
    LearnedPreferences
}
 = require("../database/models");
const WeatherService = require("../services/weather.service");
const logger = require("../utils/logger");
const { Op } = require("sequelize");

// ============================================================================
// ✅ NEURAL PREFERENCE LEARNER
// ============================================================================
class NeuralPreferenceLearner {
  constructor() {
    this.userEmbeddingDim = 64;
    this.itemEmbeddingDim = 64;
    this.contextEmbeddingDim = 32;
    this.userEmbeddingCache = new Map();
    this.itemEmbeddingCache = new Map();
  }

  async learnUserPreferences(userId) {
    console.log(`[PreferenceLearner] Learning preferences for user ${userId}`);
    
    const interactions = await UserInteraction.findAll({ 
      where: { userId }, 
      limit: 5000,
      order: [['createdAt', 'DESC']]
    });
    
    const ratings = await OutfitRating.findAll({ where: { userId } });

    if (interactions.length === 0) {
      // Still write a snapshot (marked cold-start) even with zero
      // interactions -- otherwise getRecommendationPreferences() never
      // finds a row for this user and re-enqueues a backfill job on
      // every single request forever, which is exactly the kind of
      // unnecessary repeated DB/queue traffic we're trying to avoid.
      // One cold-start snapshot per inactive user, not one attempt per
      // request.
      const coldStart = await this._getColdStartPreferences(userId);
      // findOrCreate + update, not .upsert() -- upsert's default
      // ON CONFLICT target is the primary key, and `id` here is always a
      // freshly generated UUID (never passed in), so it would never
      // actually conflict and would insert a duplicate row per call
      // instead of updating the existing one.
      const [snapshotRow] = await LearnedPreferences.findOrCreate({
        where: { userId },
        defaults: {
          userId,
          preferences: coldStart,
          embedding: null,
          interactionCount: 0,
          isColdStart: true,
          modelVersion: 'v1.0-neural',
          lastLearnedAt: new Date(),
        },
      });
      await snapshotRow.update({
        preferences: coldStart,
        interactionCount: 0,
        isColdStart: true,
        lastLearnedAt: new Date(),
      });
      return coldStart;
    }

    const preferences = {
      colors: {},
      fabrics: {},
      styles: {},
      fits: {},
      patterns: {},
      occasions: {},
      explorationRate: 0.15,
      diversityPreference: 0.5,
      trendSensitivity: 0.3,
      formalityBias: 0.0,
      weekdayPreferences: {},
      timeOfDayPreferences: {},
      seasonalPreferences: {},
      avoidedColors: {},
      avoidedFabrics: {},
      avoidedStyles: {},
    };

    for (const interaction of interactions) {
      const item = interaction.itemId 
        ? await Clothes.findByPk(interaction.itemId)
        : await this._getOutfitItems(interaction.outfitId);
      
      if (!item) continue;

      const recencyWeight = this._calculateRecencyWeight(interaction.createdAt);
      const actionWeight = this._getActionWeight(interaction.action);
      const durationWeight = this._getDurationWeight(interaction.durationSeconds);
      const finalWeight = recencyWeight * actionWeight * durationWeight;

      const items = Array.isArray(item) ? item : [item];
      for (const clothingItem of items) {
        await this._updateAttributePreference(preferences, clothingItem, finalWeight);
      }

      if (actionWeight < 0) {
        for (const clothingItem of items) {
          await this._updateRejectionPatterns(preferences, clothingItem, Math.abs(finalWeight));
        }
      }
    }

    for (const rating of ratings) {
      // Phase 2 fix: this called `OutfitCombination.findByPk(...)` --
      // OutfitCombination is never imported or defined anywhere in this
      // file (the real model, already imported above, is `Outfit`, and
      // its item-id array field is `items`, not `itemIds`). This threw a
      // ReferenceError the moment any user had OutfitRating rows -- silent
      // until now because nothing had exercised this path live yet.
      const outfit = await Outfit.findByPk(rating.outfitId);
      if (!outfit) continue;

      const ratingScore = (rating.overallRating - 1) / 4;
      const weight = ratingScore * 2.0;

      const items = await this._getItemsFromIds(outfit.items);
      for (const item of items) {
        await this._updateAttributePreference(preferences, item, weight);
      }
    }

    this._normalizeAllPreferences(preferences);

    const userEmbedding = await this._generateUserEmbedding(userId, preferences, interactions);
    this.userEmbeddingCache.set(userId, userEmbedding);

    await this._savePreferences(userId, preferences, userEmbedding, interactions.length);

    console.log(`[PreferenceLearner] Learned preferences from ${interactions.length} interactions`);
    return preferences;
  }

  /**
   * Phase 2: fast path used by recommendOutfits() at request time.
   * learnUserPreferences() above is the expensive full relearn (up to
   * 5000 interactions re-queried, an item lookup per interaction) --
   * that now only runs from the nightly job
   * (src/queues/preferenceLearningQueue.js), never inline in a request.
   *
   * This reads the persisted snapshot (one indexed query) and, if it
   * exists, applies a cheap same-day adjustment from only the
   * interactions logged since the snapshot was learned -- typically a
   * handful of rows, not thousands. Brand-new users with no snapshot yet
   * get cold-start defaults seeded from their onboarding survey instead
   * of generic zeros, and are queued for an immediate one-off learn so
   * they have a real snapshot by their next request.
   */
  async getRecommendationPreferences(userId) {
    const snapshot = await LearnedPreferences.findOne({ where: { userId } });

    if (!snapshot) {
      logger.info('No learned-preferences snapshot yet, using cold-start defaults', { userId });
      // Fire-and-forget: don't make the user's request wait on a full
      // learn. Queued lazily (require() here, not at module load) to
      // avoid a circular require between this service and the queue
      // module, which itself doesn't need this file.
      try {
        const { enqueueLearnPreferencesJob } = require('../queues/preferenceLearningQueue');
        await enqueueLearnPreferencesJob({ userId, reason: 'cold-start-backfill' });
      } catch (error) {
        logger.warn('Could not enqueue cold-start preference learning job', { userId, error: error.message });
      }
      return this._getColdStartPreferences(userId);
    }

    const basePreferences = snapshot.preferences || {};
    const sinceLearned = snapshot.lastLearnedAt || snapshot.updatedAt;

    return this._applySameDayAdjustment(userId, basePreferences, sinceLearned);
  }

  /**
   * Cold-start defaults (PRD: "derived from onboarding profile, not
   * generic"). Seeds from the survey the user already filled in at
   * signup (UserPreferences -- style persona, preferred colors/fabrics/
   * brands, budget) instead of empty maps, and biases explorationRate
   * higher than the steady-state default so early recommendations range
   * wider while there's no real interaction history to learn from yet.
   */
  async _getColdStartPreferences(userId) {
    const onboarding = await UserPreferences.findOne({ where: { userId } });

    const preferences = {
      colors: {},
      fabrics: {},
      styles: {},
      fits: {},
      patterns: {},
      occasions: {},
      explorationRate: 0.3,
      diversityPreference: 0.5,
      trendSensitivity: 0.3,
      formalityBias: 0.0,
      avoidedColors: {},
      avoidedFabrics: {},
      avoidedStyles: {},
      isNewUser: true,
      isColdStart: true,
    };

    if (onboarding) {
      const seedWeight = 0.6; // positive prior, not so strong it can't be overridden by real behavior
      for (const color of onboarding.preferredColors || []) {
        preferences.colors[color] = seedWeight;
      }
      for (const fabric of onboarding.preferredFabrics || []) {
        preferences.fabrics[fabric] = seedWeight;
      }
      for (const color of onboarding.avoidColors || []) {
        preferences.avoidedColors[color] = seedWeight;
      }
      for (const fabric of onboarding.avoidFabrics || []) {
        preferences.avoidedFabrics[fabric] = seedWeight;
      }
      if (onboarding.stylePersona) {
        preferences.styles[onboarding.stylePersona] = seedWeight;
      }
      if (onboarding.fitPreference) {
        preferences.fits[onboarding.fitPreference] = seedWeight;
      }
    }

    return preferences;
  }

  /**
   * Cheap same-day delta on top of a nightly snapshot: only looks at
   * interactions created after the snapshot was learned (bounded to
   * "since last night", not the user's whole history), and nudges a
   * shallow copy of the snapshot's normalized scores rather than
   * recomputing them from scratch. Never persisted -- purely
   * per-request, so a burst of activity today doesn't need a DB write
   * to affect the very next recommendation.
   */
  async _applySameDayAdjustment(userId, basePreferences, since) {
    const where = { userId };
    if (since) {
      where.createdAt = { [Op.gt]: since };
    }

    const recentInteractions = await UserInteraction.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 100, // same-day activity only -- a real cap, not the 5000 the nightly job uses
    });

    if (recentInteractions.length === 0) {
      return basePreferences;
    }

    const adjusted = JSON.parse(JSON.stringify(basePreferences));
    adjusted.colors = adjusted.colors || {};
    adjusted.fabrics = adjusted.fabrics || {};
    adjusted.styles = adjusted.styles || {};
    adjusted.fits = adjusted.fits || {};
    adjusted.patterns = adjusted.patterns || {};
    adjusted.occasions = adjusted.occasions || {};

    for (const interaction of recentInteractions) {
      const item = interaction.itemId ? await Clothes.findByPk(interaction.itemId) : null;
      if (!item) continue;

      const actionWeight = this._getActionWeight(interaction.action);
      // Today's signal counts for less than the full-history nightly
      // learn's own weighting -- it's a nudge, not a replacement.
      const nudgeWeight = actionWeight * 0.3;
      await this._updateAttributePreference(adjusted, item, nudgeWeight);
    }

    adjusted.isSameDayAdjusted = true;
    return adjusted;
  }

  _calculateRecencyWeight(timestamp) {
    const daysSince = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24);
    const halfLife = 30;
    return Math.exp(-daysSince * Math.log(2) / halfLife);
  }

  _getActionWeight(action) {
    const weights = {
      'wear': 1.0,
      'save': 0.9,
      'like': 0.8,
      'share': 0.85,
      'view': 0.3,
      'skip': -0.4,
      'dislike': -0.8,
    };
    return weights[action] || 0.5;
  }

  _getDurationWeight(durationSeconds) {
    if (!durationSeconds) return 1.0;
    const normalized = durationSeconds / 60;
    return 1 + 0.5 * (1 / (1 + Math.exp(-normalized + 1)));
  }

  async _updateAttributePreference(preferences, item, weight) {
    if (item.color) {
      preferences.colors[item.color] = (preferences.colors[item.color] || 0) + weight;
    }
    if (item.fabric) {
      preferences.fabrics[item.fabric] = (preferences.fabrics[item.fabric] || 0) + weight;
    }
    if (item.style) {
      preferences.styles[item.style] = (preferences.styles[item.style] || 0) + weight;
    }
    if (item.fit) {
      preferences.fits[item.fit] = (preferences.fits[item.fit] || 0) + weight;
    }
    if (item.pattern) {
      preferences.patterns[item.pattern] = (preferences.patterns[item.pattern] || 0) + weight;
    }
    if (item.occasion) {
      preferences.occasions[item.occasion] = (preferences.occasions[item.occasion] || 0) + weight;
    }
  }

  async _updateRejectionPatterns(preferences, item, weight) {
    if (item.color) {
      preferences.avoidedColors[item.color] = (preferences.avoidedColors[item.color] || 0) + weight;
    }
    if (item.fabric) {
      preferences.avoidedFabrics[item.fabric] = (preferences.avoidedFabrics[item.fabric] || 0) + weight;
    }
    if (item.style) {
      preferences.avoidedStyles[item.style] = (preferences.avoidedStyles[item.style] || 0) + weight;
    }
  }

  _normalizeAllPreferences(preferences) {
    const categories = ['colors', 'fabrics', 'styles', 'fits', 'patterns', 'occasions'];
    for (const category of categories) {
      preferences[category] = this._normalizeSingleCategory(preferences[category]);
    }
  }

  _normalizeSingleCategory(prefs) {
    const total = Object.values(prefs).reduce((sum, val) => sum + Math.max(0, val), 0);
    if (total === 0) return prefs;
    
    const normalized = {};
    for (const [key, val] of Object.entries(prefs)) {
      normalized[key] = Math.max(0, val) / total;
    }
    return normalized;
  }

  async _generateUserEmbedding(userId, preferences, interactions) {
    const embedding = new Array(this.userEmbeddingDim).fill(0);
    let idx = 0;

    const topColors = Object.entries(preferences.colors)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    for (const [color, score] of topColors) {
      if (idx < this.userEmbeddingDim) {
        embedding[idx++] = score;
      }
    }

    const topStyles = Object.entries(preferences.styles)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    for (const [style, score] of topStyles) {
      if (idx < this.userEmbeddingDim) {
        embedding[idx++] = score;
      }
    }

    if (idx < this.userEmbeddingDim) {
      embedding[idx++] = preferences.explorationRate;
      embedding[idx++] = preferences.diversityPreference;
      embedding[idx++] = preferences.trendSensitivity;
      embedding[idx++] = preferences.formalityBias;
    }

    while (idx < this.userEmbeddingDim) {
      embedding[idx++] = 0;
    }

    return embedding;
  }

  async _savePreferences(userId, preferences, userEmbedding, interactionCount = 0) {
    const existingPrefs = await UserPreferences.findOne({ where: { userId } });

    if (existingPrefs) {
      await existingPrefs.update({
        preferredColors: Object.keys(preferences.colors).slice(0, 10),
        preferredFabrics: Object.keys(preferences.fabrics).slice(0, 10),
        avoidColors: Object.keys(preferences.avoidedColors).slice(0, 5),
        avoidFabrics: Object.keys(preferences.avoidedFabrics).slice(0, 5),
      });
    }

    // Phase 2: the full computed object (previously only 4 of ~15 fields
    // survived, and only into the onboarding-survey table above) now
    // persists in full here -- this is what getRecommendationPreferences()
    // reads back at request time instead of recomputing live.
    const [snapshot] = await LearnedPreferences.findOrCreate({
      where: { userId },
      defaults: {
        userId,
        preferences,
        embedding: userEmbedding,
        interactionCount,
        isColdStart: false,
        modelVersion: 'v1.0-neural',
        lastLearnedAt: new Date(),
      },
    });
    await snapshot.update({
      preferences,
      embedding: userEmbedding,
      interactionCount,
      isColdStart: false,
      modelVersion: 'v1.0-neural',
      lastLearnedAt: new Date(),
    });
  }

  async _getOutfitItems(outfitId) {
    // Phase 2 fix: same OutfitCombination/itemIds bug as above.
    const outfit = await Outfit.findByPk(outfitId);
    if (!outfit) return null;
    return await this._getItemsFromIds(outfit.items);
  }

  async _getItemsFromIds(itemIds) {
    const items = [];
    for (const id of itemIds) {
      const item = await Clothes.findByPk(id);
      if (item) items.push(item);
    }
    return items;
  }

  _getDefaultPreferences(userId) {
    return {
      colors: {},
      fabrics: {},
      styles: {},
      explorationRate: 0.2,
      diversityPreference: 0.5,
      trendSensitivity: 0.3,
      isNewUser: true,
    };
  }
}

// ============================================================================
// ✅ CONTEXTUAL FEATURE ENGINE
// ============================================================================
class ContextualFeatureEngine {
  constructor() {
    this.contextEmbeddingDim = 32;
  }

  async generateContextVector(occasion, weather, location, timeContext) {
    const context = {
      occasion: {
        type: occasion?.toLowerCase() || 'casual',
        formality: this._getOccasionFormality(occasion),
        activityLevel: this._getActivityLevel(occasion),
        socialSetting: this._getSocialSetting(occasion),
        duration: this._getExpectedDuration(occasion),
      },
      
      weather: weather ? {
        temp: weather.temp,
        tempCategory: this._categorizeTemp(weather.temp),
        feelsLike: weather.feelsLike || weather.temp,
        condition: weather.condition,
        humidity: weather.humidity,
        windSpeed: weather.windSpeed,
        uvIndex: weather.uvIndex,
        precipitation: weather.precipitation || 0,
        visibility: weather.visibility,
        comfortIndex: this._calculateComfortIndex(weather),
        layeringRecommendation: this._getLayeringRecommendation(weather),
      } : null,
      
      time: {
        hour: timeContext?.hour || new Date().getHours(),
        dayOfWeek: timeContext?.dayOfWeek || new Date().getDay(),
        isWeekend: this._isWeekend(timeContext),
        isHoliday: timeContext?.isHoliday || false,
        season: timeContext?.season || this._getCurrentSeason(),
        timeOfDay: this._getTimeOfDay(timeContext),
        month: timeContext?.month || new Date().getMonth(),
      },
      
      location: location ? {
        city: location.city,
        country: location.country,
      } : null,
    };

    context.embedding = this._generateContextEmbedding(context);

    return context;
  }

  _getOccasionFormality(occasion) {
    if (!occasion) return 0.3;
    
    const formalityMap = {
      'black tie': 1.0,
      'wedding': 0.95,
      'interview': 0.9,
      'business': 0.8,
      'conference': 0.75,
      'business casual': 0.6,
      'date': 0.55,
      'party': 0.5,
      'brunch': 0.4,
      'casual': 0.3,
      'gym': 0.1,
      'home': 0.0,
    };
    
    return formalityMap[occasion.toLowerCase()] || 0.5;
  }

  _getActivityLevel(occasion) {
    const activityMap = {
      'gym': 1.0,
      'workout': 1.0,
      'sports': 0.95,
      'hiking': 0.9,
      'shopping': 0.6,
      'casual': 0.5,
      'date': 0.3,
      'business': 0.2,
    };
    return activityMap[occasion?.toLowerCase()] || 0.5;
  }

  _getSocialSetting(occasion) {
    const settingMap = {
      'interview': 'professional',
      'business': 'professional',
      'wedding': 'celebratory',
      'party': 'social',
      'date': 'intimate',
      'gym': 'functional',
      'casual': 'relaxed',
    };
    return settingMap[occasion?.toLowerCase()] || 'neutral';
  }

  _getExpectedDuration(occasion) {
    const durationMap = {
      'wedding': 6,
      'work': 8,
      'party': 4,
      'dinner': 3,
      'coffee': 1,
      'gym': 1.5,
    };
    return durationMap[occasion?.toLowerCase()] || 4;
  }

  _categorizeTemp(temp) {
    if (temp < 5) return 'very-cold';
    if (temp < 10) return 'cold';
    if (temp < 15) return 'cool';
    if (temp < 20) return 'mild';
    if (temp < 25) return 'comfortable';
    if (temp < 30) return 'warm';
    return 'hot';
  }

  _calculateComfortIndex(weather) {
    const idealTemp = 22;
    const idealHumidity = 50;
    
    const tempDiff = Math.abs(weather.temp - idealTemp);
    const humidityDiff = Math.abs((weather.humidity || 50) - idealHumidity);
    const windPenalty = Math.min(20, (weather.windSpeed || 0) * 2);
    
    const comfort = 100 - (tempDiff * 3) - (humidityDiff * 0.5) - windPenalty;
    return Math.max(0, Math.min(100, comfort));
  }

  _getLayeringRecommendation(weather) {
    const temp = weather.temp;
    const wind = weather.windSpeed || 0;
    const precip = weather.precipitation || 0;

    if (temp < 5 || wind > 30) return 'heavy-layering';
    if (temp < 15) return 'medium-layering';
    if (temp < 20) return 'light-layering';
    if (precip > 0.5) return 'waterproof-layer';
    return 'no-layering';
  }

  _isWeekend(timeContext) {
    const day = timeContext?.dayOfWeek || new Date().getDay();
    return day === 0 || day === 6;
  }

  _getCurrentSeason() {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'fall';
    return 'winter';
  }

  _getTimeOfDay(timeContext) {
    const hour = timeContext?.hour || new Date().getHours();
    if (hour < 6) return 'night';
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    if (hour < 21) return 'evening';
    return 'night';
  }

  _generateContextEmbedding(context) {
    const embedding = new Array(this.contextEmbeddingDim).fill(0);
    let idx = 0;

    if (context.occasion && idx < this.contextEmbeddingDim) {
      embedding[idx++] = context.occasion.formality;
      embedding[idx++] = context.occasion.activityLevel;
    }

    if (context.weather && idx < this.contextEmbeddingDim) {
      embedding[idx++] = context.weather.temp / 50;
      embedding[idx++] = (context.weather.humidity || 50) / 100;
      embedding[idx++] = context.weather.precipitation || 0;
      embedding[idx++] = context.weather.comfortIndex / 100;
    }

    if (context.time && idx < this.contextEmbeddingDim) {
      embedding[idx++] = context.time.hour / 24;
      embedding[idx++] = context.time.dayOfWeek / 7;
      embedding[idx++] = context.time.isWeekend ? 1 : 0;
    }

    while (idx < this.contextEmbeddingDim) {
      embedding[idx++] = 0;
    }

    return embedding;
  }
}

// ============================================================================
// ✅ NEURAL OUTFIT SCORER
// ============================================================================
class NeuralOutfitScorer {
  constructor() {
    this.compatibilityModel = null;
  }

  async scoreOutfit(items, context, userPreferences) {
    console.log(`[OutfitScorer] Scoring outfit with ${items.length} items`);
    
    const scores = {
      colorHarmony: await this._scoreColorHarmony(items),
      patternBalance: await this._scorePatternBalance(items),
      styleCoherence: await this._scoreStyleCoherence(items),
      occasionFit: await this._scoreOccasionFit(items, context),
      weatherAppropriate: await this._scoreWeatherFit(items, context),
      timeAppropriate: await this._scoreTimeAppropriate(items, context),
      userAlignment: await this._scoreUserAlignment(items, userPreferences),
      trendiness: await this._scoreTrendiness(items),
      comfort: await this._scoreComfort(items, context),
      versatility: await this._scoreVersatility(items),
    };

    const weights = {
      colorHarmony: 0.15,
      patternBalance: 0.10,
      styleCoherence: 0.15,
      occasionFit: 0.15,
      weatherAppropriate: 0.10,
      timeAppropriate: 0.05,
      userAlignment: 0.15,
      trendiness: 0.05,
      comfort: 0.05,
      versatility: 0.05,
    };

    const rawScore = Object.entries(scores).reduce((sum, [key, score]) => {
      return sum + (score * (weights[key] || 0));
    }, 0);

    // Phase 1 fix: "avoid repetitive suggestions" (PRD 3.3) -- applied as a
    // multiplicative penalty on the final score rather than as an 11th
    // weighted dimension, so it doesn't require re-normalizing the
    // existing weights (which already sum to 1.0) or change what any
    // individual breakdown score means. An outfit built from pieces worn
    // in the last couple of days still shows up if it's genuinely the
    // best match (nothing here hard-filters it out), it's just ranked
    // below an equally-good fresher alternative.
    const recency = this._scoreRecency(items);
    const totalScore = Math.min(1.0, Math.max(0.0, rawScore)) * recency.factor;

    const reasoning = this._generateDetailedReasoning(scores, items, context, recency);

    return {
      totalScore,
      rawScore: Math.min(1.0, Math.max(0.0, rawScore)),
      breakdown: scores,
      recency,
      reasoning,
      confidence: this._calculateConfidence(scores),
    };
  }

  /**
   * Phase 1 fix: recency penalty feeding the "avoid recently worn" scoring
   * adjustment above. Looks at each item's own `lastWornAt` (already
   * tracked on Clothes) -- the freshest wear across the outfit's items
   * determines the penalty, since a single very-recently-worn centerpiece
   * (e.g. the same jacket) makes an outfit feel repetitive even if every
   * other piece is new. No wear within the window -> no penalty at all.
   */
  _scoreRecency(items, windowDays = 2) {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const wornTimestamps = items
      .map(item => item.lastWornAt ? new Date(item.lastWornAt).getTime() : null)
      .filter(ts => ts !== null && !Number.isNaN(ts));

    if (wornTimestamps.length === 0) {
      return { factor: 1.0, daysSinceMostRecentWear: null, note: null };
    }

    const mostRecentWear = Math.max(...wornTimestamps);
    const daysSince = (now - mostRecentWear) / DAY_MS;

    if (daysSince >= windowDays) {
      return { factor: 1.0, daysSinceMostRecentWear: Math.floor(daysSince), note: null };
    }

    // Linear ramp: worn moments ago -> factor floors at 0.4 (still
    // suggestible if truly nothing else fits), worn right at the edge of
    // the window -> factor 1.0 (no penalty).
    const minFactor = 0.4;
    const factor = minFactor + (1 - minFactor) * Math.max(0, daysSince / windowDays);
    const daysSinceFloored = Math.max(0, Math.floor(daysSince));

    return {
      factor,
      daysSinceMostRecentWear: daysSinceFloored,
      note: daysSinceFloored < 1
        ? '🔁 Includes a piece worn very recently'
        : `🔁 Includes a piece worn ${daysSinceFloored} day(s) ago`,
    };
  }

  async _scoreColorHarmony(items) {
    const colors = items.map(item => item.color).filter(Boolean);
    if (colors.length < 2) return 0.85;

    let totalHarmony = 0;
    let comparisons = 0;

    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const harmony = this._getColorHarmonyScore(colors[i], colors[j]);
        totalHarmony += harmony;
        comparisons++;
      }
    }

    const avgHarmony = comparisons > 0 ? totalHarmony / comparisons : 0.7;
    const uniqueColors = [...new Set(colors.map(c => c.toLowerCase()))];
    
    if (uniqueColors.length === 1) {
      return Math.min(1.0, avgHarmony + 0.1);
    }

    return avgHarmony;
  }

  _getColorHarmonyScore(color1, color2) {
    const c1 = color1.toLowerCase();
    const c2 = color2.toLowerCase();

    const neutrals = ['white', 'black', 'gray', 'grey', 'beige', 'cream', 'navy', 'brown'];
    if (neutrals.includes(c1) || neutrals.includes(c2)) return 0.95;

    const complementary = {
      'red': ['green', 'teal'],
      'blue': ['orange', 'coral'],
      'yellow': ['purple', 'violet'],
    };
    if (complementary[c1]?.includes(c2) || complementary[c2]?.includes(c1)) {
      return 0.98;
    }

    if (c1 === c2) return 0.85;

    return 0.45;
  }

  async _scorePatternBalance(items) {
    const patterns = items.map(item => item.pattern).filter(p => p && p !== 'solid');
    
    if (patterns.length === 0) return 0.85;
    if (patterns.length === 1) return 0.95;
    if (patterns.length === 2) return 0.70;
    return 0.40;
  }

  async _scoreStyleCoherence(items) {
    const styles = items.map(item => item.style).filter(Boolean);
    if (styles.length === 0) return 0.5;

    const uniqueStyles = [...new Set(styles.map(s => s.toLowerCase()))];
    if (uniqueStyles.length === 1) return 0.98;

    let totalCompat = 0;
    let comparisons = 0;

    for (let i = 0; i < uniqueStyles.length; i++) {
      for (let j = i + 1; j < uniqueStyles.length; j++) {
        const compat = this._getStyleCompatibility(uniqueStyles[i], uniqueStyles[j]);
        totalCompat += compat;
        comparisons++;
      }
    }

    return comparisons > 0 ? totalCompat / comparisons : 0.5;
  }

  _getStyleCompatibility(style1, style2) {
    const compatibility = {
      'casual': { 'streetwear': 0.95, 'sporty': 0.90, 'business-casual': 0.60, 'formal': 0.25 },
      'formal': { 'business': 0.98, 'elegant': 0.95, 'casual': 0.20 },
      'streetwear': { 'casual': 0.95, 'sporty': 0.90, 'formal': 0.15 },
      'sporty': { 'casual': 0.90, 'athletic': 0.98, 'formal': 0.15 },
    };

    const s1 = style1.toLowerCase();
    const s2 = style2.toLowerCase();

    return compatibility[s1]?.[s2] || compatibility[s2]?.[s1] || 0.50;
  }

  async _scoreOccasionFit(items, context) {
    if (!context?.occasion) return 0.5;

    const targetFormality = context.occasion.formality;
    let totalFit = 0;

    for (const item of items) {
      const itemFormality = this._getItemFormality(item);
      const formalityFit = 1 - Math.abs(targetFormality - itemFormality);
      totalFit += formalityFit;
    }

    return items.length > 0 ? totalFit / items.length : 0.5;
  }

  _getItemFormality(item) {
    const formalityMap = {
      'suit': 1.0, 'blazer': 0.90, 'dress pants': 0.85,
      'dress': 0.80, 'jeans': 0.40, 'tshirt': 0.30,
      'hoodie': 0.25, 'shorts': 0.20, 'sweatpants': 0.15,
    };
    return formalityMap[item.type?.toLowerCase()] || 0.50;
  }

  async _scoreWeatherFit(items, context) {
    if (!context?.weather) return 0.5;

    const weather = context.weather;
    let totalFit = 0;

    for (const item of items) {
      const tempFit = this._getTemperatureFit(item, weather.temp);
      totalFit += tempFit;
    }

    return items.length > 0 ? totalFit / items.length : 0.5;
  }

  _getTemperatureFit(item, temp) {
    const coldItems = ['coat', 'jacket', 'sweater', 'boots'];
    const hotItems = ['shorts', 'tank top', 'sandals', 'tshirt'];
    const type = item.type?.toLowerCase();

    if (temp < 10 && coldItems.includes(type)) return 1.0;
    if (temp > 25 && hotItems.includes(type)) return 1.0;
    if (temp >= 15 && temp <= 25) return 0.8;
    
    return 0.5;
  }

  async _scoreTimeAppropriate(items, context) {
    return 0.7;
  }

  async _scoreUserAlignment(items, userPreferences) {
    if (!userPreferences) return 0.5;

    let totalAlignment = 0;
    let factors = 0;

    for (const item of items) {
      if (userPreferences.colors && item.color) {
        const colorPref = userPreferences.colors[item.color] || 0;
        totalAlignment += colorPref;
        factors++;
      }

      if (userPreferences.styles && item.style) {
        const stylePref = userPreferences.styles[item.style] || 0;
        totalAlignment += stylePref;
        factors++;
      }
    }

    const avgAlignment = factors > 0 ? totalAlignment / factors : 0.5;
    return Math.max(0, Math.min(1.0, avgAlignment));
  }

  async _scoreTrendiness(items) {
    return 0.60 + Math.random() * 0.3;
  }

  async _scoreComfort(items, context) {
    return 0.75;
  }

  async _scoreVersatility(items) {
    const neutrals = ['black', 'white', 'gray', 'navy', 'beige'];
    let versatilityScore = 0;
    
    for (const item of items) {
      if (neutrals.includes(item.color?.toLowerCase())) {
        versatilityScore += 0.2;
      }
    }

    return Math.min(1.0, versatilityScore / items.length);
  }

  _generateDetailedReasoning(scores, items, context, recency = null) {
    const reasons = [];

    if (scores.colorHarmony > 0.85) reasons.push("✨ Excellent color harmony");
    if (scores.styleCoherence > 0.85) reasons.push("👌 Cohesive style");
    if (scores.occasionFit > 0.85) reasons.push(`🎯 Perfect for ${context?.occasion?.type}`);
    if (scores.weatherAppropriate > 0.85) reasons.push("☀️ Weather-appropriate");
    if (scores.userAlignment > 0.80) reasons.push("💯 Matches your style");
    if (recency?.note) reasons.push(recency.note);

    return reasons.length > 0 ? reasons.join(" • ") : "Balanced outfit";
  }

  _calculateConfidence(scores) {
    const values = Object.values(scores);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    return Math.max(0.5, 1.0 - stdDev);
  }
}

// ============================================================================
// ✅ DIVERSITY ENGINE
// ============================================================================
class DiversityEngine {
  constructor(explorationRate = 0.15) {
    this.explorationRate = explorationRate;
  }

  applyDiversityRanking(scoredOutfits, userPreferences, count = 5) {
    scoredOutfits.sort((a, b) => b.score.totalScore - a.score.totalScore);

    // Phase 2 fix: explorationRate/diversityPreference were learned per
    // user (NeuralPreferenceLearner) but never actually reached here --
    // this engine used only its own hardcoded constructor value
    // (0.15, set once at service startup) no matter who was asking.
    // Falls back to the constructor default for a user with no
    // preferences object at all (shouldn't happen now that cold-start
    // always returns one, but kept as a safety net).
    const explorationRate = userPreferences?.explorationRate ?? this.explorationRate;
    const diversityPreference = userPreferences?.diversityPreference ?? 0.5;

    const selected = [];
    const exploitCount = Math.floor(count * (1 - explorationRate));
    const topOutfits = scoredOutfits.slice(0, exploitCount);
    selected.push(...topOutfits);

    const remaining = scoredOutfits.slice(exploitCount);
    const exploreCount = count - exploitCount;
    const diverseOutfits = this._selectDiverseOutfits(remaining, exploreCount, selected, diversityPreference);
    selected.push(...diverseOutfits);

    for (let i = exploitCount; i < selected.length; i++) {
      selected[i].isExploration = true;
      selected[i].explorationReason = "Something new for you to try";
    }

    return selected.slice(0, count);
  }

  _selectDiverseOutfits(outfits, count, alreadySelected, diversityPreference = 0.5) {
    const selectedColors = new Set(alreadySelected.flatMap(o => o.items.map(i => i.color)));

    for (const outfit of outfits) {
      const colors = outfit.items.map(i => i.color);
      const colorNovelty = colors.filter(c => !selectedColors.has(c)).length / colors.length;
      outfit.diversityScore = colorNovelty;
      // Phase 2 fix: diversityPreference was computed by the learner but
      // never read here -- this blend was a fixed 0.6/0.4 for every
      // user. A user with a low diversityPreference now gets
      // exploration picks that stay closer to their normal score;
      // a high one leans further into novelty.
      outfit.explorationScore = outfit.diversityScore * diversityPreference + outfit.score.totalScore * (1 - diversityPreference);
    }

    outfits.sort((a, b) => b.explorationScore - a.explorationScore);
    return outfits.slice(0, count);
  }
}

// ============================================================================
// ✅ MAIN AI OUTFIT SERVICE WITH TRIP MODE INTEGRATION
// ============================================================================
class AIOutfitRecommendationService {
  constructor() {
    this.preferenceLearner = new NeuralPreferenceLearner();
    this.contextEngine = new ContextualFeatureEngine();
    this.outfitScorer = new NeuralOutfitScorer();
    this.diversityEngine = new DiversityEngine(0.15);
  }

  /**
   * ✅ MAIN RECOMMENDATION FUNCTION WITH TRIP MODE DETECTION
   * Automatically detects if user is on a trip and uses only packed items
   */
  async recommendOutfits(userId, occasion, options = {}) {
    console.log(`\n========================================`);
    console.log(`🤖 AI OUTFIT ENGINE - Generating recommendations`);
    console.log(`User: ${userId} | Occasion: ${occasion}`);
    console.log(`========================================\n`);

    try {
      const startTime = Date.now();

      // ✅ STEP 1: CHECK IF USER IS ON A TRIP
      const user = await User.findByPk(userId);
      const isOnTrip = user ? user.isOnTrip() : false;
      
      if (isOnTrip) {
        console.log(`✈️ TRIP MODE ACTIVE: Using packed items only`);
        console.log(`📍 Destination: ${user.tripDestination}`);
        console.log(`📅 Trip: ${user.tripStartDate} to ${user.tripEndDate}`);
      }

      // ✅ STEP 2: GET WARDROBE (packed items if on trip, otherwise full closet)
      let clothes;
      if (options.clothes) {
        // If clothes explicitly provided in options, use those
        clothes = options.clothes;
      } else if (isOnTrip && user.packedItems && user.packedItems.length > 0) {
        // User is on trip - use ONLY packed items
        clothes = await Clothes.findAll({
          where: {
            id: user.packedItems,
            userId: userId,
            isActive: true
          }
        });
        console.log(`👔 Using packed items: ${clothes.length} items`);
      } else {
        // Normal mode - use full wardrobe
        clothes = await Clothes.findAll({
          where: {
            userId: userId,
            isActive: true
          }
        });
        console.log(`👔 Using full wardrobe: ${clothes.length} items`);
      }
      
      if (!clothes || clothes.length === 0) {
        return { 
          outfits: [], 
          message: isOnTrip 
            ? "No packed items available. Check your trip packing list."
            : "No clothes in wardrobe",
          suggestions: isOnTrip 
            ? ["View your trip packing list to see available items"]
            : ["Add items to your wardrobe to get AI-powered recommendations"],
          tripMode: isOnTrip
        };
      }

      // ✅ STEP 3: GET USER PREFERENCES
      // Phase 2 fix: this used to call learnUserPreferences() directly,
      // recomputing the full model (up to 5000 interactions re-queried,
      // an item lookup per interaction) on every single recommendation
      // request. It now reads the nightly job's persisted snapshot plus
      // a cheap same-day delta -- see getRecommendationPreferences().
      console.log(`📊 Loading learned preferences...`);
      const userPreferences = await this.preferenceLearner.getRecommendationPreferences(userId);
      console.log(`✓ Preferences loaded`);

      // ✅ STEP 4: GET WEATHER DATA
      let weather = options.weather;
      if (!weather && options.city && options.country) {
        try {
          weather = await WeatherService.getCurrentWeather(options.city, options.country);
          console.log(`✓ Weather: ${weather.temp}°C, ${weather.condition}`);
        } catch (err) {
          console.warn("Weather fetch error:", err.message);
        }
      }

      // ✅ STEP 5: GENERATE CONTEXT VECTOR
      console.log(`🌍 Generating context...`);
      const context = await this.contextEngine.generateContextVector(
        occasion,
        weather,
        options.location,
        options.timeContext
      );

      // ✅ STEP 6: APPLY HARD CONSTRAINTS
      console.log(`🔍 Filtering wardrobe...`);
      let candidateItems = this._applyHardConstraints(clothes, context, userPreferences);
      if (candidateItems.length === 0) {
        candidateItems = clothes; // Fallback
      }
      console.log(`✓ ${candidateItems.length} items pass constraints`);

      // ✅ STEP 7: GENERATE OUTFIT COMBINATIONS
      console.log(`🎨 Generating outfit combinations...`);
      const outfitCombinations = this._generateOutfitCombinations(candidateItems, context);
      console.log(`✓ Generated ${outfitCombinations.length} combinations`);

      // ✅ STEP 8: SCORE ALL COMBINATIONS
      console.log(`⚖️ Scoring outfits...`);
      const scoredOutfits = [];
      
      for (const combo of outfitCombinations) {
        const score = await this.outfitScorer.scoreOutfit(combo.items, context, userPreferences);
        scoredOutfits.push({
          ...combo,
          score,
        });
      }
      console.log(`✓ Scored ${scoredOutfits.length} outfits`);

      // ✅ STEP 9: APPLY DIVERSITY RANKING
      console.log(`🌈 Applying diversity ranking...`);
      const rankedOutfits = this.diversityEngine.applyDiversityRanking(
        scoredOutfits,
        userPreferences,
        options.count || 5
      );
      console.log(`✓ Selected top ${rankedOutfits.length} diverse outfits`);

      // ✅ STEP 10: ENRICH WITH INSIGHTS
      console.log(`💡 Generating insights...`);
      for (const outfit of rankedOutfits) {
        outfit.insights = await this._generateOutfitInsights(outfit, context, userPreferences);
        
        // Add trip mode context to insights
        if (isOnTrip) {
          outfit.insights.tripContext = {
            destination: user.tripDestination,
            daysRemaining: this._calculateDaysRemaining(user.tripEndDate)
          };
        }
      }

      const duration = Date.now() - startTime;
      console.log(`\n✅ Recommendations generated in ${duration}ms\n`);

      // Phase 2: RecommendationLog was fully defined in the schema but
      // never actually written to anywhere -- swap detection and outfit-
      // regret detection both need a record of what was *suggested* to
      // compare against what was ultimately worn. This is the only
      // write; the controller layer only calls recommendOutfits() at
      // all on a cache miss (see outfit.controller.js's
      // getTodayOutfit/getTomorrowOutfit/getCustomOutfit), so a cached
      // response never causes a duplicate log row. Wrapped in try/catch
      // so a logging failure can never fail the actual recommendation
      // response the user is waiting on.
      try {
        await RecommendationLog.create({
          userId,
          occasion,
          recommendedOutfits: rankedOutfits.map((o) => ({
            itemIds: o.items.map((i) => i.id),
            totalScore: o.score?.totalScore ?? null,
            isExploration: !!o.isExploration,
          })),
          context,
          userPreferencesSnapshot: userPreferences,
          modelVersion: 'v1.0-neural',
        });
      } catch (logError) {
        logger.warn('Failed to write RecommendationLog', { userId, error: logError.message });
      }

      return {
        outfits: rankedOutfits,
        context,
        userPreferences,
        tripMode: isOnTrip, // ✅ Indicate if in trip mode
        tripInfo: isOnTrip ? { // ✅ Trip context
          destination: user.tripDestination,
          startDate: user.tripStartDate,
          endDate: user.tripEndDate,
          daysRemaining: this._calculateDaysRemaining(user.tripEndDate)
        } : null,
        metadata: {
          totalCombinations: outfitCombinations.length,
          wardrobeSize: clothes.length,
          filterApplied: candidateItems.length < clothes.length,
          processingTime: duration,
          timestamp: new Date().toISOString(),
          modelVersion: 'v1.0-neural',
        },
      };

    } catch (error) {
      console.error("❌ AI Outfit Recommendation Error:", error);
      throw error;
    }
  }

  /**
   * ✅ APPLY HARD CONSTRAINTS
   */
  _applyHardConstraints(clothes, context, preferences) {
    let filtered = [...clothes];

    if (context.weather) {
      const temp = context.weather.temp;
      
      if (temp < 5) {
        filtered = filtered.filter(item => 
          item.season === 'winter' || 
          item.season === 'fall' ||
          ['jacket', 'coat', 'sweater', 'boots'].includes(item.type?.toLowerCase())
        );
      }
      
      else if (temp > 30) {
        filtered = filtered.filter(item =>
          item.season === 'summer' ||
          ['tshirt', 'tank-top', 'shorts', 'dress', 'sandals'].includes(item.type?.toLowerCase())
        );
      }
    }

    if (context.occasion) {
      const formality = context.occasion.formality;
      
      if (formality > 0.8) {
        filtered = filtered.filter(item =>
          !['shorts', 'hoodie', 'sweatpants', 'sneakers', 'tshirt'].includes(item.type?.toLowerCase())
        );
      }
      
      if (context.occasion.type === 'gym' || context.occasion.activityLevel > 0.8) {
        filtered = filtered.filter(item =>
          ['activewear', 'athletic', 'sporty'].includes(item.style?.toLowerCase()) ||
          ['shorts', 'tank-top', 'leggings', 'sneakers', 'tshirt'].includes(item.type?.toLowerCase())
        );
      }
    }

    return filtered;
  }

  /**
   * ✅ GENERATE OUTFIT COMBINATIONS
   */
  _generateOutfitCombinations(items, context) {
    console.log(`[CombinationEngine] Generating combinations from ${items.length} items`);

    const itemsByType = {
      tops: items.filter(i => ['shirt', 'tshirt', 'blouse', 'top', 'sweater'].includes(i.type?.toLowerCase())),
      bottoms: items.filter(i => ['pants', 'jeans', 'skirt', 'shorts', 'trousers'].includes(i.type?.toLowerCase())),
      dresses: items.filter(i => i.type?.toLowerCase() === 'dress'),
      outerwear: items.filter(i => ['jacket', 'coat', 'blazer', 'cardigan'].includes(i.type?.toLowerCase())),
      shoes: items.filter(i => ['shoes', 'sneakers', 'boots', 'sandals', 'heels'].includes(i.type?.toLowerCase())),
    };

    const combinations = [];
    const maxCombinations = 200;

    // STRATEGY 1: DRESS-BASED OUTFITS
    for (const dress of itemsByType.dresses.slice(0, 15)) {
      const outfit = { items: [dress] };
      
      if (context.weather?.temp < 20 && itemsByType.outerwear.length > 0) {
        outfit.items.push(itemsByType.outerwear[0]);
      }
      
      if (itemsByType.shoes.length > 0) {
        outfit.items.push(itemsByType.shoes[0]);
      }
      
      combinations.push(outfit);
      if (combinations.length >= maxCombinations) break;
    }

    // STRATEGY 2: TOP + BOTTOM COMBINATIONS
    for (const top of itemsByType.tops.slice(0, 20)) {
      for (const bottom of itemsByType.bottoms.slice(0, 12)) {
        if (!this._areItemsCompatible(top, bottom)) continue;

        const outfit = { items: [top, bottom] };
        
        if (context.weather?.temp < 22 && itemsByType.outerwear.length > 0) {
          outfit.items.push(itemsByType.outerwear[0]);
        }
        
        if (itemsByType.shoes.length > 0) {
          outfit.items.push(itemsByType.shoes[0]);
        }
        
        combinations.push(outfit);
        if (combinations.length >= maxCombinations) break;
      }
      if (combinations.length >= maxCombinations) break;
    }

    console.log(`[CombinationEngine] Generated ${combinations.length} combinations`);
    return combinations;
  }

  /**
   * ✅ QUICK COMPATIBILITY CHECK
   */
  _areItemsCompatible(item1, item2) {
    const formality1 = this.outfitScorer._getItemFormality(item1);
    const formality2 = this.outfitScorer._getItemFormality(item2);
    if (Math.abs(formality1 - formality2) > 0.5) return false;

    if (item1.color && item2.color) {
      const colorScore = this.outfitScorer._getColorHarmonyScore(item1.color, item2.color);
      if (colorScore < 0.4) return false;
    }

    return true;
  }

  /**
   * ✅ GENERATE OUTFIT INSIGHTS
   */
  async _generateOutfitInsights(outfit, context, userPreferences) {
    const insights = {
      whyRecommended: [],
      styleNotes: [],
      tips: [],
      perfectFor: [],
    };

    if (outfit.score?.totalScore > 0.85) {
      insights.whyRecommended.push("Excellent overall match");
    }
    if (outfit.score?.breakdown?.colorHarmony > 0.85) {
      insights.whyRecommended.push("Beautiful color harmony");
    }
    if (outfit.score?.breakdown?.userAlignment > 0.80) {
      insights.whyRecommended.push("Perfectly matches your style");
    }
    if (outfit.score?.breakdown?.occasionFit > 0.85) {
      insights.whyRecommended.push(`Ideal for ${context.occasion?.type}`);
    }
    if (outfit.isExploration) {
      insights.whyRecommended.push("✨ " + outfit.explorationReason);
    }

    const styles = [...new Set(outfit.items.map(i => i.style).filter(Boolean))];
    if (styles.length === 1) {
      insights.styleNotes.push(`Cohesive ${styles[0]} aesthetic`);
    }

    const colors = [...new Set(outfit.items.map(i => i.color).filter(Boolean))];
    if (colors.length === 1) {
      insights.styleNotes.push(`Monochromatic ${colors[0]}`);
    } else if (colors.length === 2) {
      insights.styleNotes.push(`${colors[0]} and ${colors[1]} pairing`);
    }

    if (context.weather) {
      if (context.weather.temp < 15) {
        insights.tips.push("🧥 Consider adding a warm layer");
      }
      if (context.weather.precipitation > 0.5) {
        insights.tips.push("☔ Don't forget an umbrella");
      }
      if (context.weather.uvIndex > 7) {
        insights.tips.push("🕶️ High UV - wear sunscreen");
      }
    }

    return insights;
  }

  /**
   * ✅ CALCULATE DAYS REMAINING IN TRIP
   */
  _calculateDaysRemaining(endDate) {
    const today = new Date();
    const end = new Date(endDate);
    const diffTime = end - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }

  /**
   * ✅ RECORD USER FEEDBACK
   */
  async recordFeedback(userId, outfitId, feedback) {
    // Implement feedback recording logic
    console.log(`Recording feedback for user ${userId}`);
    return { success: true };
  }
}

// ============================================================================
// ✅ EXPORT SERVICE
// ============================================================================
const aiOutfitService = new AIOutfitRecommendationService();

module.exports = {
  aiOutfitService,
  AIOutfitRecommendationService,
  
  async recommendOutfits(userId, occasion, options) {
    return await aiOutfitService.recommendOutfits(userId, occasion, options);
  },
  
  async recordFeedback(userId, outfitId, feedback) {
    return await aiOutfitService.recordFeedback(userId, outfitId, feedback);
  },
};