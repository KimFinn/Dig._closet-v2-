/**
 * Production-Ready MCP Fashion Tagger System - Node.js/TypeScript
 * Enterprise-grade clothing attribute detection using Vision AI APIs
 * 
 * Features:
 * - Multi-provider support (Claude, GPT-4, Google Vision)
 * - Redis Cloud caching for cost optimization
 * - Automatic fallback handling
 * - Comprehensive error handling
 * - Production-ready monitoring
 * 
 * @author AI Fashion Tagger Team
 * @version 1.0.0
 */

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const vision = require('@google-cloud/vision');
const redis = require('redis');
const crypto = require('crypto');
const sharp = require('sharp'); // For image processing
const fs = require('fs').promises;

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Vision API Provider enumeration
 * Defines available AI vision providers
 */
const VisionProvider = {
  ANTHROPIC_CLAUDE: 'anthropic_claude',
  OPENAI_GPT4: 'openai_gpt4',
  GOOGLE_VISION: 'google_vision'
};

/**
 * MCP Configuration Class
 * Centralizes all configuration settings for the fashion tagger
 */
class MCPConfig {
  constructor(options = {}) {
    // API Keys - Load from environment variables for security
    this.anthropicApiKey = options.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    this.openaiApiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;
    this.googleCredentialsPath = options.googleCredentialsPath || process.env.GOOGLE_CREDENTIALS_PATH;
    
    // Provider settings
    this.primaryProvider = options.primaryProvider || VisionProvider.ANTHROPIC_CLAUDE;
    this.fallbackProviders = options.fallbackProviders || [
      VisionProvider.OPENAI_GPT4,
      VisionProvider.GOOGLE_VISION
    ];
    
    // Redis Cloud Configuration
    this.redisHost = options.redisHost || process.env.REDIS_CLOUD_HOST || 'localhost';
    this.redisPort = options.redisPort || process.env.REDIS_CLOUD_PORT || 6379;
    this.redisPassword = options.redisPassword || process.env.REDIS_CLOUD_PASSWORD;
    // Was `... : true` — defaulted to requiring TLS even when nothing
    // passed an explicit choice, which breaks a plain local dev Redis
    // (see REDIS_TLS note in the two callers of this config). Both real
    // callers now pass this explicitly either way, but the fallback
    // itself should not assume a managed/cloud Redis.
    this.redisUseSSL = options.redisUseSSL !== undefined ? options.redisUseSSL : (process.env.REDIS_TLS === 'true');
    
    // Cache settings
    this.useCache = options.useCache !== undefined ? options.useCache : true;
    this.cacheTTL = options.cacheTTL || 86400; // 24 hours in seconds
    
    // Performance settings
    this.maxImageSizeMB = options.maxImageSizeMB || 10;
    this.compressionQuality = options.compressionQuality || 85;
    this.requestTimeout = options.requestTimeout || 30000; // 30 seconds
    this.maxRetries = options.maxRetries || 3;
    
    // Monitoring
    this.enableMetrics = options.enableMetrics !== undefined ? options.enableMetrics : true;
    this.enableLogging = options.enableLogging !== undefined ? options.enableLogging : true;
  }
}

// ============================================================================
// DATA MODELS
// ============================================================================

/**
 * Clothing Metadata Model
 * Represents all detected attributes for a clothing item
 */
class ClothingMetadata {
  constructor(data = {}) {
    // Core fashion attributes
    this.clothingCategory = data.clothingCategory || data.clothing_category || 'shirt';
    this.subType = data.subType || data.sub_type || null;
    this.fabric = data.fabric || [];
    this.color = data.color || [];
    this.pattern = data.pattern || 'solid';
    this.season = data.season || [];
    this.fit = data.fit || 'regular fit';
    this.brand = data.brand || null;
    this.logoPresence = data.logoPresence || data.logo_presence || false;
    this.formality = data.formality || 'casual';
    this.genderStyle = data.genderStyle || data.gender_style || 'unisex';
    this.sleeveLength = data.sleeveLength || data.sleeve_length || null;
    this.occasion = data.occasion || [];
    
    // Quality metrics
    this.confidenceScore = data.confidenceScore || data.confidence_score || 0.0;
    this.processingTimeMs = data.processingTimeMs || data.processing_time_ms || 0.0;
    this.providerUsed = data.providerUsed || data.provider_used || '';
    this.cached = data.cached || false;
    
    // Management metadata
    this.itemId = data.itemId || data.item_id || null;
    this.userId = data.userId || data.user_id || null;
    this.dateAdded = data.dateAdded || data.date_added || new Date().toISOString();
    this.imageHash = data.imageHash || data.image_hash || null;
    
    // Quality control
    this.needsReview = data.needsReview || data.needs_review || false;
    this.reviewNotes = data.reviewNotes || data.review_notes || null;
    this.userCorrections = data.userCorrections || data.user_corrections || {};
  }

  /**
   * Convert metadata to plain JavaScript object
   * @returns {Object} Plain object representation
   */
  toJSON() {
    return {
      clothing_category: this.clothingCategory,
      sub_type: this.subType,
      fabric: this.fabric,
      color: this.color,
      pattern: this.pattern,
      season: this.season,
      fit: this.fit,
      brand: this.brand,
      logo_presence: this.logoPresence,
      formality: this.formality,
      gender_style: this.genderStyle,
      sleeve_length: this.sleeveLength,
      occasion: this.occasion,
      confidence_score: this.confidenceScore,
      processing_time_ms: this.processingTimeMs,
      provider_used: this.providerUsed,
      cached: this.cached,
      item_id: this.itemId,
      user_id: this.userId,
      date_added: this.dateAdded,
      image_hash: this.imageHash,
      needs_review: this.needsReview,
      review_notes: this.reviewNotes,
      user_corrections: this.userCorrections
    };
  }
}

/**
 * Tagging Result Model
 * Wraps the result of a tagging operation with status information
 */
class TaggingResult {
  constructor(success, metadata = null, error = null, providerUsed = '', cached = false, processingTimeMs = 0) {
    this.success = success;
    this.metadata = metadata;
    this.error = error;
    this.providerUsed = providerUsed;
    this.cached = cached;
    this.processingTimeMs = processingTimeMs;
  }
}

// ============================================================================
// PROMPT ENGINEERING
// ============================================================================

/**
 * Fashion Prompt Builder
 * Constructs optimized prompts for accurate fashion attribute detection
 */
class FashionPromptBuilder {
  /**
   * Build comprehensive classification prompt for vision AI
   * @returns {string} Detailed prompt for fashion analysis
   */
  static buildClassificationPrompt() {
    return `Analyze this clothing item image and extract detailed fashion attributes.

**IMPORTANT**: Return ONLY valid JSON, no markdown formatting, no code blocks, no explanations.

Analyze and return a JSON object with these exact keys:

{
  "clothing_category": "one of: shirt, t-shirt, blouse, tank-top, polo, sweater, hoodie, cardigan, blazer, jacket, coat, vest, dress, skirt, pants, jeans, shorts, leggings, suit, jumpsuit, romper, sweatpants, activewear",
  
  "sub_type": "specific type like: skinny jeans, bootcut jeans, button-down shirt, turtleneck sweater, maxi dress, etc. If unclear, use null",
  
  "fabric": ["array of fabrics detected: denim, cotton, polyester, silk, wool, cashmere, leather, suede, linen, velvet, satin, chiffon, knit, fleece, corduroy, tweed, jersey, nylon"],
  
  "color": ["array of all visible colors in order of prominence: black, white, gray, beige, brown, tan, red, burgundy, pink, coral, orange, yellow, gold, green, olive, mint, blue, navy, teal, turquoise, purple, lavender, multi-color"],
  
  "pattern": "one of: solid, striped, plaid, checked, gingham, floral, dotted, polka-dot, geometric, abstract, animal-print, leopard, zebra, camouflage, tie-dye, ombre, color-block, paisley, houndstooth",
  
  "season": ["array of suitable seasons: summer, winter, spring, fall, all-season, transitional"],
  
  "fit": "one of: slim fit, regular fit, relaxed fit, oversized, tailored, loose, tight, athletic fit, boxy",
  
  "brand": "brand name if logo visible (nike, adidas, gucci, etc.), or null if not visible",
  
  "logo_presence": true if brand logo/text visible, false otherwise,
  
  "formality": "one of: casual, smart casual, business casual, formal, semi-formal, sport, athletic, loungewear",
  
  "gender_style": "one of: unisex, male oriented, female oriented",
  
  "sleeve_length": "one of: sleeveless, cap sleeve, short sleeve, 3/4 sleeve, long sleeve, cropped sleeve, or null for non-tops",
  
  "occasion": ["array of suitable occasions: party, office, travel, gym, casual daily, formal event, date night, beach, outdoor, lounge, workout, business meeting, wedding"],
  
  "confidence_score": 0.0-1.0 (your confidence in this analysis),
  
  "needs_review": true if image quality is poor or item is unclear, false otherwise,
  
  "review_notes": "brief note if needs_review is true, otherwise null"
}

**CRITICAL RULES**:
1. Return ONLY the JSON object, nothing else
2. All string values must use double quotes
3. Arrays must have at least one item
4. Be specific with sub_type when possible
5. List colors in order of prominence
6. Consider fabric texture carefully
7. Season should reflect when the item would be worn

Return the JSON now:`;
  }
}

// ============================================================================
// REDIS CACHE MANAGER
// ============================================================================

/**
 * Redis Cache Manager
 * Handles all caching operations with Redis Cloud
 * Provides automatic reconnection and error handling
 */
class RedisCacheManager {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.connected = false;
    
    // Statistics tracking
    this.stats = {
      hits: 0,
      misses: 0,
      errors: 0,
      totalRequests: 0
    };
    
    // Initialize connection if cache is enabled
    if (config.useCache) {
      this.connect();
    }
  }

  /**
   * Establish connection to Redis Cloud
   * Handles SSL/TLS configuration and authentication
   */
  async connect() {
    try {
      // Redis Cloud connection options
      const redisOptions = {
        socket: {
          host: this.config.redisHost,
          port: this.config.redisPort,
          // Enable TLS/SSL for Redis Cloud
          tls: this.config.redisUseSSL,
          rejectUnauthorized: false // Accept self-signed certificates
        },
        password: this.config.redisPassword,
        // Connection timeout and retry settings
        connectTimeout: 10000,
        retryStrategy: (times) => {
          // Exponential backoff for retries
          const delay = Math.min(times * 50, 2000);
          return delay;
        }
      };

      // Create Redis client
      this.client = redis.createClient(redisOptions);

      // Event handlers for connection monitoring
      this.client.on('connect', () => {
        console.log('✅ Connected to Redis Cloud');
        this.connected = true;
      });

      this.client.on('error', (err) => {
        console.error('❌ Redis connection error:', err.message);
        this.connected = false;
      });

      this.client.on('reconnecting', () => {
        console.log('🔄 Reconnecting to Redis Cloud...');
      });

      // Establish connection
      await this.client.connect();

      // Test connection with ping
      await this.client.ping();
      console.log('✅ Redis Cloud connection verified');

    } catch (error) {
      console.error('❌ Failed to connect to Redis Cloud:', error.message);
      this.connected = false;
      // Continue without cache rather than failing
      console.log('⚠️ Continuing without cache');
    }
  }

  /**
   * Generate unique hash for image data
   * Uses SHA-256 for consistent hashing
   * @param {Buffer} imageBuffer - Image data as buffer
   * @returns {string} Hex hash of image
   */
  getImageHash(imageBuffer) {
    return crypto.createHash('sha256').update(imageBuffer).digest('hex');
  }

  /**
   * Retrieve cached tagging result
   * @param {string} imageHash - Hash of the image
   * @returns {Object|null} Cached metadata or null if not found
   */
  async get(imageHash) {
    // Skip if not connected
    if (!this.connected || !this.client) {
      return null;
    }

    this.stats.totalRequests++;

    try {
      const cacheKey = `fashion_tag:${imageHash}`;
      const cached = await this.client.get(cacheKey);

      if (cached) {
        // Cache hit - parse and return
        this.stats.hits++;
        console.log(`📦 Cache HIT: ${imageHash.substring(0, 8)}...`);
        return JSON.parse(cached);
      } else {
        // Cache miss
        this.stats.misses++;
        console.log(`📭 Cache MISS: ${imageHash.substring(0, 8)}...`);
        return null;
      }

    } catch (error) {
      // Log error but don't throw - graceful degradation
      this.stats.errors++;
      console.error('❌ Cache get error:', error.message);
      return null;
    }
  }

  /**
   * Store tagging result in cache
   * @param {string} imageHash - Hash of the image
   * @param {Object} metadata - Metadata to cache
   * @returns {boolean} Success status
   */
  async set(imageHash, metadata) {
    // Skip if not connected
    if (!this.connected || !this.client) {
      return false;
    }

    try {
      const cacheKey = `fashion_tag:${imageHash}`;
      const value = JSON.stringify(metadata);

      // Set with TTL (Time To Live)
      await this.client.setEx(cacheKey, this.config.cacheTTL, value);
      console.log(`💾 Cached: ${imageHash.substring(0, 8)}... (TTL: ${this.config.cacheTTL}s)`);
      return true;

    } catch (error) {
      this.stats.errors++;
      console.error('❌ Cache set error:', error.message);
      return false;
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache performance metrics
   */
  getStats() {
    const total = this.stats.totalRequests;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(1) : 0;

    return {
      totalRequests: total,
      cacheHits: this.stats.hits,
      cacheMisses: this.stats.misses,
      errors: this.stats.errors,
      hitRate: `${hitRate}%`
    };
  }

  /**
   * Close Redis connection gracefully
   */
  async close() {
    if (this.client && this.connected) {
      await this.client.quit();
      console.log('✅ Redis connection closed');
    }
  }
}

// ============================================================================
// VISION API CLIENTS
// ============================================================================

/**
 * Anthropic Claude Vision API Client
 * Handles communication with Claude's vision capabilities
 */
class AnthropicClaudeClient {
  constructor(config) {
    this.config = config;
    // Initialize Anthropic SDK with API key
    this.client = new Anthropic({
      apiKey: config.anthropicApiKey
    });
  }

  /**
   * Tag clothing using Claude Vision
   * @param {Buffer} imageBuffer - Image data
   * @returns {Object} Parsed fashion attributes
   */
  async tagClothing(imageBuffer) {
    // Convert image to base64 for API
    const base64Image = imageBuffer.toString('base64');

    // Build classification prompt
    const prompt = FashionPromptBuilder.buildClassificationPrompt();

    // Call Claude API with vision capabilities
    const message = await this.client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Image
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }]
    });

    // Extract and parse response
    const responseText = message.content[0].text;
    return this._parseJSONResponse(responseText);
  }

  /**
   * Parse JSON from API response
   * Handles various response formats (plain JSON, markdown code blocks)
   * @param {string} responseText - Raw API response
   * @returns {Object} Parsed JSON object
   */
  _parseJSONResponse(responseText) {
    let jsonStr = responseText.trim();

    // Handle markdown code blocks: ```json ... ```
    if (jsonStr.includes('```json')) {
      jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
    } else if (jsonStr.includes('```')) {
      jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
    }

    // Parse JSON
    try {
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('Failed to parse JSON response:', error.message);
      console.error('Response text:', jsonStr);
      throw new Error('Invalid JSON response from vision API');
    }
  }
}

/**
 * OpenAI GPT-4 Vision API Client
 * Handles communication with GPT-4 Vision
 */
class OpenAIGPT4Client {
  constructor(config) {
    this.config = config;
    // Initialize OpenAI SDK
    this.client = new OpenAI({
      apiKey: config.openaiApiKey
    });
  }

  /**
   * Tag clothing using GPT-4 Vision
   * @param {Buffer} imageBuffer - Image data
   * @returns {Object} Parsed fashion attributes
   */
  async tagClothing(imageBuffer) {
    // Convert to base64 data URL
    const base64Image = imageBuffer.toString('base64');
    const imageUrl = `data:image/jpeg;base64,${base64Image}`;

    // Build prompt
    const prompt = FashionPromptBuilder.buildClassificationPrompt();

    // Call GPT-4 Vision API
    const response = await this.client.chat.completions.create({
      model: 'gpt-4-vision-preview',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }],
      max_tokens: 2000
    });

    // Parse response
    const responseText = response.choices[0].message.content;
    return this._parseJSONResponse(responseText);
  }

  /**
   * Parse JSON from API response
   * @param {string} responseText - Raw API response
   * @returns {Object} Parsed JSON object
   */
  _parseJSONResponse(responseText) {
    let jsonStr = responseText.trim();

    // Handle markdown code blocks
    if (jsonStr.includes('```json')) {
      jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
    } else if (jsonStr.includes('```')) {
      jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
    }

    return JSON.parse(jsonStr);
  }
}

/**
 * Google Cloud Vision API Client
 * Provides basic tagging using Google's vision capabilities
 * Note: Less detailed than Claude/GPT-4 but faster and cheaper
 */
class GoogleVisionClient {
  constructor(config) {
    this.config = config;
    // Set credentials path for Google Cloud
    process.env.GOOGLE_APPLICATION_CREDENTIALS = config.googleCredentialsPath;
    // Initialize Vision API client
    this.client = new vision.ImageAnnotatorClient();
  }

  /**
   * Tag clothing using Google Vision
   * @param {Buffer} imageBuffer - Image data
   * @returns {Object} Basic fashion attributes
   */
  async tagClothing(imageBuffer) {
    // Perform label detection
    const [result] = await this.client.labelDetection({
      image: { content: imageBuffer }
    });

    const labels = result.labelAnnotations.map(label => label.description.toLowerCase());

    // Perform color detection
    const [properties] = await this.client.imageProperties({
      image: { content: imageBuffer }
    });

    const dominantColors = properties.imagePropertiesAnnotation.dominantColors.colors;

    // Map Google's results to our taxonomy
    return this._mapToTaxonomy(labels, dominantColors);
  }

  /**
   * Map Google Vision results to fashion taxonomy
   * @param {string[]} labels - Detected labels
   * @param {Object[]} colors - Detected colors
   * @returns {Object} Fashion attributes
   */
  _mapToTaxonomy(labels, colors) {
    // Category mapping
    const categoryMap = {
      'shirt': 'shirt',
      'blouse': 'blouse',
      'dress': 'dress',
      'pants': 'pants',
      'jeans': 'jeans',
      'jacket': 'jacket',
      'sweater': 'sweater',
      'coat': 'coat'
    };

    // Find clothing category from labels
    let clothingCategory = 'shirt'; // default
    for (const label of labels) {
      if (categoryMap[label]) {
        clothingCategory = categoryMap[label];
        break;
      }
    }

    // Extract dominant colors
    const colorNames = colors.slice(0, 3).map(color => 
      this._rgbToColorName(color.color.red, color.color.green, color.color.blue)
    );

    // Return basic taxonomy (Google Vision provides less detail)
    return {
      clothing_category: clothingCategory,
      sub_type: null,
      fabric: ['cotton'], // default assumption
      color: colorNames.length > 0 ? colorNames : ['multi-color'],
      pattern: 'solid',
      season: ['all-season'],
      fit: 'regular fit',
      brand: null,
      logo_presence: false,
      formality: 'casual',
      gender_style: 'unisex',
      sleeve_length: null,
      occasion: ['casual daily'],
      confidence_score: 0.7,
      needs_review: true,
      review_notes: 'Basic attributes from Google Vision - manual review recommended'
    };
  }

  /**
   * Convert RGB values to color name
   * @param {number} r - Red (0-255)
   * @param {number} g - Green (0-255)
   * @param {number} b - Blue (0-255)
   * @returns {string} Color name
   */
  _rgbToColorName(r, g, b) {
    // Simple color name mapping
    if (r > 200 && g > 200 && b > 200) return 'white';
    if (r < 50 && g < 50 && b < 50) return 'black';
    if (r > Math.max(g, b) + 30) return 'red';
    if (b > Math.max(r, g) + 30) return 'blue';
    if (g > Math.max(r, b) + 30) return 'green';
    if (r > 150 && g > 150 && b < 100) return 'yellow';
    return 'multi-color';
  }
}

// ============================================================================
// MAIN MCP FASHION TAGGER
// ============================================================================

/**
 * MCP Fashion Tagger
 * Main class orchestrating the entire fashion tagging pipeline
 * 
 * Features:
 * - Multi-provider support with automatic fallback
 * - Redis Cloud caching for cost optimization
 * - Image preprocessing and optimization
 * - Comprehensive error handling
 * - Production-ready monitoring
 */
class MCPFashionTagger {
  constructor(config) {
    this.config = config;
    
    // Initialize cache manager
    this.cache = new RedisCacheManager(config);
    
    // Initialize vision API clients
    this.clients = this._initializeClients();
    
    console.log('✅ MCP Fashion Tagger initialized');
    console.log(`   Primary provider: ${config.primaryProvider}`);
    console.log(`   Cache enabled: ${config.useCache}`);
  }

  /**
   * Initialize all configured vision API clients
   * @returns {Object} Map of provider to client instance
   */
  _initializeClients() {
    const clients = {};

    // Initialize Anthropic Claude if API key provided
    if (this.config.anthropicApiKey) {
      clients[VisionProvider.ANTHROPIC_CLAUDE] = new AnthropicClaudeClient(this.config);
      console.log('✅ Anthropic Claude client initialized');
    }

    // Initialize OpenAI GPT-4 if API key provided
    if (this.config.openaiApiKey) {
      clients[VisionProvider.OPENAI_GPT4] = new OpenAIGPT4Client(this.config);
      console.log('✅ OpenAI GPT-4 client initialized');
    }

    // Initialize Google Vision if credentials provided
    if (this.config.googleCredentialsPath) {
      clients[VisionProvider.GOOGLE_VISION] = new GoogleVisionClient(this.config);
      console.log('✅ Google Vision client initialized');
    }

    return clients;
  }

  /**
   * Tag a clothing item from image
   * Main entry point for fashion attribute detection
   * 
   * @param {string|Buffer} image - Image file path or buffer
   * @param {string} userId - Optional user identifier
   * @param {string} itemId - Optional item identifier
   * @returns {TaggingResult} Tagging result with metadata or error
   */
  async tagClothing(image, userId = null, itemId = null) {
    const startTime = Date.now();

    try {
      // Load and preprocess image
      const imageBuffer = await this._loadAndPreprocessImage(image);

      // Generate image hash for caching
      const imageHash = this.cache.getImageHash(imageBuffer);

      // Check cache first
      if (this.config.useCache) {
        const cachedResult = await this.cache.get(imageHash);
        if (cachedResult) {
          console.log('✅ Using cached result');
          const metadata = new ClothingMetadata({
            ...cachedResult,
            cached: true,
            user_id: userId,
            item_id: itemId,
            image_hash: imageHash
          });

          return new TaggingResult(
            true,
            metadata,
            null,
            cachedResult.provider_used,
            true,
            Date.now() - startTime
          );
        }
      }

      // Call vision API with fallback mechanism
      const { result, providerUsed } = await this._callVisionAPIWithFallback(imageBuffer);

      // Post-process results
      const enhancedResult = this._postProcessResult(result);

      // Create metadata object
      const metadata = new ClothingMetadata({
        ...enhancedResult,
        processing_time_ms: Date.now() - startTime,
        provider_used: providerUsed,
        user_id: userId,
        item_id: itemId,
        image_hash: imageHash,
        date_added: new Date().toISOString()
      });

      // Cache the result
      if (this.config.useCache) {
        await this.cache.set(imageHash, enhancedResult);
      }

      console.log(`✅ Successfully tagged as ${metadata.clothingCategory} in ${metadata.processingTimeMs}ms`);

      return new TaggingResult(
        true,
        metadata,
        null,
        providerUsed,
        false,
        metadata.processingTimeMs
      );

    } catch (error) {
      console.error('❌ Tagging failed:', error.message);
      
      return new TaggingResult(
        false,
        null,
        error.message,
        '',
        false,
        Date.now() - startTime
      );
    }
  }

  /**
   * Load image from file path or buffer and preprocess
   * Handles compression and format conversion
   * 
   * @param {string|Buffer} image - Image file path or buffer
   * @returns {Buffer} Preprocessed image buffer
   */
  async _loadAndPreprocessImage(image) {
    let imageBuffer;

    // Load image based on input type
    if (Buffer.isBuffer(image)) {
      imageBuffer = image;
    } else if (typeof image === 'string') {
      imageBuffer = await fs.readFile(image);
    } else {
      throw new Error('Invalid image input: must be file path or Buffer');
    }

    // Preprocess image with sharp
    // - Resize if too large
    // - Convert to JPEG
    // - Compress to reduce API costs
    imageBuffer = await sharp(imageBuffer)
      .resize(1024, 1024, { // Max dimensions
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: this.config.compressionQuality })
      .toBuffer();

    // Check file size
    const sizeMB = imageBuffer.length / (1024 * 1024);
    if (sizeMB > this.config.maxImageSizeMB) {
      // Further compress if still too large
      imageBuffer = await sharp(imageBuffer)
        .jpeg({ quality: Math.max(50, this.config.compressionQuality - 20) })
        .toBuffer();
    }

    return imageBuffer;
  }

  /**
   * Call vision API with automatic fallback
   * Tries primary provider first, then fallbacks if needed
   * 
   * @param {Buffer} imageBuffer - Preprocessed image
   * @returns {Object} Result and provider used
   */
  async _callVisionAPIWithFallback(imageBuffer) {
    // Build list of providers to try
    const providers = [
      this.config.primaryProvider,
      ...this.config.fallbackProviders
    ];

    // Try each provider in order
    for (const provider of providers) {
      // Skip if client not initialized
      if (!this.clients[provider]) {
        console.log(`⚠️ Skipping ${provider} - not configured`);
        continue;
      }

      try {
        console.log(`🔄 Attempting with ${provider}...`);
        
        // Call the vision API
        const result = await this.clients[provider].tagClothing(imageBuffer);
        
        console.log(`✅ Success with ${provider}`);
        return { result, providerUsed: provider };

      } catch (error) {
        console.error(`❌ ${provider} failed:`, error.message);
        // Continue to next provider
        continue;
      }
    }

    // All providers failed
    throw new Error('All vision API providers failed');
  }

  /**
   * Post-process and enhance API results
   * Ensures all required fields exist and validates data
   * 
   * @param {Object} result - Raw API result
   * @returns {Object} Enhanced result
   */
  _postProcessResult(result) {
    // Default values for all required fields
    const defaults = {
      clothing_category: 'shirt',
      sub_type: null,
      fabric: ['cotton'],
      color: ['multi-color'],
      pattern: 'solid',
      season: ['all-season'],
      fit: 'regular fit',
      brand: null,
      logo_presence: false,
      formality: 'casual',
      gender_style: 'unisex',
      sleeve_length: null,
      occasion: ['casual daily'],
      confidence_score: 0.8,
      needs_review: false,
      review_notes: null
    };

    // Merge with defaults
    const enhanced = { ...defaults, ...result };

    // Validate and infer missing attributes
    return this._inferAttributes(enhanced);
  }

  /**
   * Infer missing attributes from existing ones
   * Uses fashion rules to fill in gaps
   * 
   * @param {Object} result - Result to enhance
   * @returns {Object} Enhanced result
   */
  _inferAttributes(result) {
    // Infer season from sleeve length and fabric
    if (!result.season || result.season.length === 0 || result.season[0] === 'all-season') {
      if (result.sleeve_length === 'sleeveless' || result.sleeve_length === 'short sleeve') {
        result.season = ['summer', 'spring'];
      } else if (result.sleeve_length === 'long sleeve' || 
                 result.fabric.includes('wool') || 
                 result.fabric.includes('fleece')) {
        result.season = ['winter', 'fall'];
      }
    }

    // Infer occasions from formality
    if (!result.occasion || result.occasion.length === 0 || result.occasion[0] === 'casual daily') {
      if (result.formality === 'formal') {
        result.occasion = ['formal event', 'business meeting', 'wedding'];
      } else if (result.formality === 'business casual') {
        result.occasion = ['office', 'business meeting'];
      } else if (result.formality === 'sport') {
        result.occasion = ['gym', 'workout', 'outdoor'];
      }
    }

    return result;
  }

  /**
   * Batch tag multiple clothing items
   * Processes images in parallel for efficiency
   * 
   * @param {Array} images - Array of image paths or buffers
   * @param {string} userId - Optional user identifier
   * @returns {Array<TaggingResult>} Array of tagging results
   */
  async batchTagClothing(images, userId = null) {
    console.log(`📦 Batch tagging ${images.length} items...`);

    // Process all images in parallel
    const promises = images.map((image, index) => 
      this.tagClothing(image, userId, `batch_${index}`)
    );

    const results = await Promise.all(promises);

    // Log summary
    const successful = results.filter(r => r.success).length;
    const cached = results.filter(r => r.cached).length;
    console.log(`✅ Batch complete: ${successful}/${images.length} successful, ${cached} from cache`);

    return results;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache performance metrics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Close all connections gracefully
   */
  async close() {
    await this.cache.close();
    console.log('✅ MCP Fashion Tagger closed');
  }
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

/**
 * Example usage of MCP Fashion Tagger
 */
async function main() {
  // Load environment variables
  require('dotenv').config();

  // Configure the tagger
  const config = new MCPConfig({
    // API Keys
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    googleCredentialsPath: process.env.GOOGLE_CREDENTIALS_PATH,
    
    // Provider settings
    primaryProvider: VisionProvider.ANTHROPIC_CLAUDE,
    fallbackProviders: [
      VisionProvider.OPENAI_GPT4,
      VisionProvider.GOOGLE_VISION
    ],
    
    // Redis Cloud settings
    redisHost: process.env.REDIS_CLOUD_HOST,
    redisPort: parseInt(process.env.REDIS_CLOUD_PORT),
    redisPassword: process.env.REDIS_CLOUD_PASSWORD,
    redisUseSSL: true,
    
    // Cache settings
    useCache: true,
    cacheTTL: 86400, // 24 hours
    
    // Performance
    maxImageSizeMB: 10,
    compressionQuality: 85,
    requestTimeout: 30000,
    maxRetries: 3
  });

  // Initialize tagger
  const tagger = new MCPFashionTagger(config);

  try {
    console.log('\n📸 Tagging clothing item...');
    
    // Tag a single item
    const result = await tagger.tagClothing(
      'shirt.jpg', // image file path
      'user_12345', // user ID
      'item_001' // item ID
    );

    if (result.success) {
      const meta = result.metadata;
      
      console.log('\n✅ Tagging successful!');
      console.log('═══════════════════════════════════════');
      console.log(`Category: ${meta.clothingCategory}`);
      console.log(`Colors: ${meta.color.join(', ')}`);
      console.log(`Pattern: ${meta.pattern}`);
      console.log(`Fabric: ${meta.fabric.join(', ')}`);
      console.log(`Fit: ${meta.fit}`);
      console.log(`Formality: ${meta.formality}`);
      console.log(`Occasions: ${meta.occasion.join(', ')}`);
      console.log(`Season: ${meta.season.join(', ')}`);
      console.log('═══════════════════════════════════════');
      console.log(`Provider: ${result.providerUsed}`);
      console.log(`Cached: ${result.cached ? 'Yes' : 'No'}`);
      console.log(`Processing time: ${result.processingTimeMs}ms`);
      console.log(`Confidence: ${(meta.confidenceScore * 100).toFixed(1)}%`);
      
      // Full JSON output
      console.log('\n📄 Full metadata JSON:');
      console.log(JSON.stringify(meta.toJSON(), null, 2));
    } else {
      console.error('\n❌ Tagging failed:', result.error);
    }

    // Show cache statistics
    console.log('\n📊 Cache Statistics:');
    console.log(tagger.getCacheStats());

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Clean up
    await tagger.close();
  }
}

// Export classes for use as module
module.exports = {
  MCPFashionTagger,
  MCPConfig,
  VisionProvider,
  ClothingMetadata,
  TaggingResult
};

// Run example if executed directly
if (require.main === module) {
  main().catch(console.error);
}