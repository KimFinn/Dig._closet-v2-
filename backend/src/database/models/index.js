const {Sequelize,DataTypes} = require('sequelize');
require('dotenv').config();

// Initialize sequalize instance
//
// Switched from MySQL to PostgreSQL. The `define.charset`/`collate` block
// was MySQL-only config (utf8mb4 collation) and is invalid/ignored under
// the postgres dialect — Postgres databases are UTF8 by default, so it's
// simply dropped rather than translated. `pg`/`pg-hstore` replace
// `mysql2` as the driver (see package.json). Schema is now owned by the
// migrations in src/database/migrations/ (run via `npm run db:migrate`,
// or `npm run seed` to migrate + seed in one step) rather than by
// `sequelize.sync()` at boot — see server.js.
const sequelize = new Sequelize (
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        dialect: 'postgres',
        logging: process.env.NODE_ENV ==='development' ? console.log : false,
        pool: {
            max: 10,
            min: 0,
            acquire: 30000,
            idle: 10000
        },
        define: {
            timestamps: true,
            underscored: true,
        }
    }
);

// User Model
const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true
        }
    },
    password: {
        type: DataTypes.STRING(255),
        // OAuth-only users (Google/Apple sign-in, see googleId/appleId
        // below) never set a password, so this can no longer be
        // required. Password-based login/register/change-password all
        // still require it at the request-validation layer (Joi); this
        // is just the storage constraint being relaxed to allow the
        // OAuth case.
        allowNull: true,
        field: 'password_hash'
    },
    fullName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'full_name'
    },
    googleId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        unique: true,
        field: 'google_id',
        comment: 'Google account `sub` claim, set on first Google sign-in'
    },
    appleId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        unique: true,
        field: 'apple_id',
        comment: 'Apple account `sub` claim, set on first Apple sign-in'
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: 'is_active'
    },
    lastLogin: {
        type: DataTypes.DATE,
        field: 'last_login'
    },
    
    // ========================================================================
    // ✅ NEW: TRIP MODE TRACKING FIELDS
    // ========================================================================
    
    activeTripId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'active_trip_id',
        comment: 'ID of currently active trip (set when trip starts, cleared when ends)'
    },
    
    tripStartDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'trip_start_date',
        comment: 'Start date of active trip'
    },
    
    tripEndDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'trip_end_date',
        comment: 'End date of active trip'
    },
    
    packedItems: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: null,
        field: 'packed_items',
        comment: 'Array of clothing item IDs that user packed for trip',
        validate: {
            isArrayOrNull(value) {
                if (value !== null && !Array.isArray(value)) {
                    throw new Error('packedItems must be an array or null');
                }
            }
        }
    },
    
    tripDestination: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'trip_destination',
        comment: 'Current trip destination for context'
    },

    // Phase 8 (PRD §7/§3.9): free | plus | pro. No billing integration
    // yet -- see migration 20260924000004-add-subscription-tier-to-users
    // for why this is a stub, set manually via PATCH /auth/me/subscription
    // rather than a payment webhook, exactly like every other
    // credential-gated integration in this app.
    subscriptionTier: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'free',
        field: 'subscription_tier',
        validate: { isIn: { args: [['free', 'plus', 'pro']] } }
    },

    // Phase 10 (PRD §3.11, scoped 2026-09-18): retention mechanics.
    // `timezone` is a real IANA name captured once client-side (see
    // auth.controller.js#updateProfile) -- nothing tracked this before,
    // and the evening-digest send-hour preference is meaningless without
    // it. Null falls back to UTC everywhere this is read.
    timezone: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'IANA timezone, e.g. "America/New_York". Null falls back to UTC.'
    },

    // Daily check-in streak. "Checking in" = logging a wear -- see
    // checkInStreak.service.js -- no separate action needed. A missed
    // day FREEZES the streak at its current count rather than resetting
    // it to 0 (2026-09-18 decision: genuinely non-punitive mechanics,
    // not just softer copy), so this only ever goes up.
    currentStreak: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'current_streak'
    },
    longestStreak: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'longest_streak'
    },
    lastCheckInDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'last_check_in_date',
        comment: "The user's own local calendar date of their last counted check-in."
    }

}, {
    tableName: 'users',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['email'] },
        { fields: ['created_at'] },
        { fields: ['active_trip_id'] }, // New index for trip queries
        { fields: ['trip_start_date', 'trip_end_date'] } // For cron job queries
        // googleId/appleId already get a unique index from `unique: true`
        // on their column definitions above (Postgres unique constraints
        // treat multiple NULLs as distinct, so this doesn't block more
        // than one password-only user from having no googleId/appleId).
    ]
});

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Check if user is currently on a trip
 */
User.prototype.isOnTrip = function() {
    if (!this.activeTripId) return false;
    
    const today = new Date().toISOString().split('T')[0];
    return this.tripStartDate <= today && this.tripEndDate >= today;
};

/**
 * Activate trip mode
 */
User.prototype.activateTrip = async function(tripId, startDate, endDate, packedItemIds, destination) {
    this.activeTripId = tripId;
    this.tripStartDate = startDate;
    this.tripEndDate = endDate;
    this.packedItems = packedItemIds;
    this.tripDestination = destination;
    await this.save();
};

/**
 * Deactivate trip mode
 */
User.prototype.deactivateTrip = async function() {
    this.activeTripId = null;
    this.tripStartDate = null;
    this.tripEndDate = null;
    this.packedItems = null;
    this.tripDestination = null;
    await this.save();
};

/**
 * Get available wardrobe (full closet or just packed items)
 */
User.prototype.getAvailableItemIds = function() {
    if (this.isOnTrip() && this.packedItems && this.packedItems.length > 0) {
        return this.packedItems;
    }
    return null; // null means "use full wardrobe"
};

// ============================================================================
// CLASS METHODS
// ============================================================================

/**
 * Find users whose trips should start today
 */
User.findTripsToActivate = async function() {
    const today = new Date().toISOString().split('T')[0];
    
    return await User.findAll({
        where: {
            activeTripId: null, // Not already on a trip
            tripStartDate: today // Trip starts today
        }
    });
};

/**
 * Find users whose trips should end today
 */
User.findTripsToDeactivate = async function() {
    const today = new Date().toISOString().split('T')[0];
    
    return await User.findAll({
        where: {
            activeTripId: { [sequelize.Op.ne]: null }, // Currently on a trip
            tripEndDate: { [sequelize.Op.lt]: today } // Trip ended before today
        }
    });
};

/**
 * Update user's last login timestamp
 */
User.prototype.updateLastLogin = async function() {
    this.lastLogin = new Date();
    await this.save();
};


// clothes.model.js
const Clothes = sequelize.define('Clothes', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: 'Unique identifier for the clothing item'
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: {
            model: 'users',
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Reference to the user who owns this item'
    },
    type: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: {
                msg: 'Clothing type cannot be empty'
            }
        },
        comment: 'Type of clothing (e.g., shirt, pants, dress, jacket)'
    },
    color: {
        type: DataTypes.STRING(100),
        validate: {
            len: {
                args: [0, 100],
                msg: 'Color must be less than 100 characters'
            }
        },
        comment: 'Primary color of the clothing item'
    },
    pattern: {
        type: DataTypes.STRING(100),
        comment: 'Pattern type (e.g., solid, striped, floral, checkered)'
    },
    fabric: {
        type: DataTypes.STRING(100),
        comment: 'Fabric material (e.g., cotton, polyester, wool, silk)'
    },
    season: {
        type: DataTypes.STRING(100),
        comment: 'Appropriate season(s) for wearing this item (comma-separated if multiple)'
    },
    occasion: {
        type: DataTypes.STRING(100),
        comment: 'Suitable occasion (e.g., casual, formal, business, athletic)'
    },
    brand: {
        type: DataTypes.STRING(100),
        comment: 'Brand or manufacturer of the clothing item'
    },
    size: {
        type: DataTypes.STRING(20),
        comment: 'Size of the clothing item (e.g., S, M, L, XL, or numeric)'
    },
    purchasePrice: {
        type: DataTypes.DECIMAL(10, 2),
        field: 'purchase_price',
        validate: {
            min: {
                args: [0],
                msg: 'Purchase price cannot be negative'
            }
        },
        comment: 'Original purchase price of the item'
    },
    purchaseDate: {
        type: DataTypes.DATEONLY,
        field: 'purchase_date',
        comment: 'Date when the item was purchased'
    },
    imageUrl: {
        type: DataTypes.STRING(500),
        allowNull: false,
        field: 'image_url',
        validate: {
            isUrl: {
                msg: 'Must be a valid URL'
            }
        },
        comment: 'URL to the clothing item image'
    },
    cloudinaryPublicId: {
        type: DataTypes.STRING(255),
        field: 'cloudinary_public_id',
        comment: 'Cloudinary public ID for image management and deletion'
    },
    tags: {
        type: DataTypes.JSONB,
        defaultValue: [],
        validate: {
            isValidArray(value) {
                if (value !== null && !Array.isArray(value)) {
                    throw new Error('Tags must be an array');
                }
            }
        },
        comment: 'Array of tags for better categorization and search'
    },
    notes: {
        type: DataTypes.TEXT,
        comment: 'Additional notes or description about the item'
    },
    wearCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
        field: 'wear_count',
        validate: {
            min: {
                args: [0],
                msg: 'Wear count cannot be negative'
            }
        },
        comment: 'Number of times this item has been worn'
    },
    lastWornAt: {
        type: DataTypes.DATE,
        field: 'last_worn_at',
        comment: 'Timestamp of when the item was last worn'
    },
    // Phase 10 (PRD §3.11): last time this item was surfaced in a
    // "haven't worn this in a while" evening-digest nudge. Distinct from
    // lastWornAt -- purely a cooldown so the same neglected item isn't
    // renominated every single night (see closetResurfacing.service.js).
    lastNudgedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_nudged_at',
        comment: 'Last time this item was included in a resurfacing nudge (cooldown, not a wear event).'
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        field: 'is_active',
        comment: 'Soft delete flag - false means item is archived/deleted'
    },
    isFavorite: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
        field: 'is_favorite',
        comment: 'Whether this item is marked as favorite by the user'
    },
    condition: {
        type: DataTypes.ENUM('new', 'excellent', 'good', 'fair', 'poor'),
        defaultValue: 'good',
        comment: 'Current condition of the clothing item'
    },
    careInstructions: {
        type: DataTypes.TEXT,
        field: 'care_instructions',
        comment: 'Washing and care instructions for the item'
    },

    // ========================================================================
    // NEW FIELDS FOR AI METADATA
    // ========================================================================
    
    aiMetadata: {
        // This was DataTypes.JSONB, a Postgres-only type, back when the
        // project's dialect was MySQL — it crashed table creation there
        // ("Unknown data type: 'JSONB'") and was temporarily downgraded
        // to DataTypes.JSON as a Phase 0 fix. Now that the project has
        // switched to Postgres (see sequelize config above), JSONB is
        // back and is in fact the right choice here: binary-stored,
        // supports containment/indexing (e.g. a GIN index on
        // `ai_metadata->>'provider'`), unlike plain JSON's text storage.
        type: DataTypes.JSONB,
        field: 'ai_metadata',
        defaultValue: null,
        comment: 'AI tagging metadata including provider, confidence, cache status'
        /**
         * Expected structure:
         * {
         *   confidence: 0.95,
         *   provider: "anthropic_claude",
         *   cached: false,
         *   needsReview: false,
         *   taggedAt: "2025-03-04T10:30:00Z",
         *   retaggedAt: "2025-03-05T14:20:00Z" // if retagged
         * }
         */
    },
    
    aiGeneratedTags: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
        field: 'ai_generated_tags',
        comment: 'Whether this item was tagged using AI (true) or manually (false)'
    },
    
    aiConfidenceScore: {
        type: DataTypes.DECIMAL(3, 2), // e.g., 0.95
        field: 'ai_confidence_score',
        validate: {
            min: 0,
            max: 1
        },
        comment: 'AI confidence score for the tagging (0.0 to 1.0)'
    },
    
    needsManualReview: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: 'needs_manual_review',
        comment: 'Flag indicating if AI tagging failed or has low confidence'
    }

}, {
    tableName: 'clothes',
    timestamps: true, // Adds createdAt and updatedAt
    underscored: true, // Use snake_case for auto-generated fields
    
    indexes: [
        {
            name: 'idx_clothes_user_id',
            fields: ['user_id'],
            comment: 'Index for fast user-based queries'
        },
        {
            name: 'idx_clothes_created_at',
            fields: ['created_at'],
            comment: 'Index for chronological sorting'
        },
        {
            name: 'idx_clothes_type',
            fields: ['type'],
            comment: 'Index for filtering by clothing type'
        },
        {
            name: 'idx_clothes_season',
            fields: ['season'],
            comment: 'Index for seasonal filtering'
        },
        {
            name: 'idx_clothes_is_active',
            fields: ['is_active'],
            comment: 'Index for soft delete queries'
        },
        {
            name: 'idx_clothes_user_active',
            fields: ['user_id', 'is_active'],
            comment: 'Composite index for user active items queries'
        },
        {
            name: 'idx_clothes_wear_count',
            fields: ['wear_count'],
            comment: 'Index for sorting by popularity'
        },
        {
            name: 'idx_clothes_last_worn',
            fields: ['last_worn_at'],
            comment: 'Index for finding least/most recently worn items'
        },
        // NEW INDEXES FOR AI FEATURES
        {
            name: 'idx_clothes_ai_confidence',
            fields: ['ai_confidence_score'],
            comment: 'Index for filtering by AI confidence'
        },
        {
            name: 'idx_clothes_needs_review',
            fields: ['needs_manual_review'],
            comment: 'Index for finding items needing manual review'
        },
        {
            name: 'idx_clothes_ai_generated',
            fields: ['ai_generated_tags'],
            comment: 'Index for filtering AI vs manually tagged items'
        }
    ],
    
    hooks: {
        beforeValidate: (item) => {
            // Trim string fields
            if (item.type) item.type = item.type.trim();
            if (item.color) item.color = item.color.trim();
            if (item.pattern) item.pattern = item.pattern.trim();
            if (item.fabric) item.fabric = item.fabric.trim();
            if (item.brand) item.brand = item.brand.trim();
            if (item.size) item.size = item.size.trim();
            
            // Set aiGeneratedTags flag based on aiMetadata presence
            if (item.aiMetadata && !item.aiGeneratedTags) {
                item.aiGeneratedTags = true;
            }
            
            // Extract confidence score from metadata if not set
            if (item.aiMetadata && item.aiMetadata.confidence && !item.aiConfidenceScore) {
                item.aiConfidenceScore = item.aiMetadata.confidence;
            }
        },
        
        afterCreate: (item) => {
            // Log creation for analytics
            console.log(`New clothing item created: ${item.id} for user: ${item.userId}`);
            
            // Log if AI-generated
            if (item.aiGeneratedTags) {
                console.log(`AI-tagged with ${item.aiConfidenceScore} confidence`);
            }
        }
    }
});

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Custom JSON serialization
 */
Clothes.prototype.toJSON = function() {
    const values = { ...this.get() };
    return values;
};

/**
 * Mark item as worn and update statistics
 */
Clothes.prototype.markAsWorn = async function() {
    this.wearCount += 1;
    this.lastWornAt = new Date();
    await this.save();
    return this;
};

/**
 * Toggle favorite status
 */
Clothes.prototype.toggleFavorite = async function() {
    this.isFavorite = !this.isFavorite;
    await this.save();
    return this;
};

/**
 * Check if item needs retagging (low confidence or failed)
 */
Clothes.prototype.needsRetagging = function() {
    return this.needsManualReview || 
           !this.aiGeneratedTags || 
           (this.aiConfidenceScore && this.aiConfidenceScore < 0.7);
};

/**
 * Get AI tagging quality indicator
 */
Clothes.prototype.getAIQuality = function() {
    if (!this.aiConfidenceScore) return 'unknown';
    if (this.aiConfidenceScore >= 0.9) return 'excellent';
    if (this.aiConfidenceScore >= 0.8) return 'good';
    if (this.aiConfidenceScore >= 0.7) return 'fair';
    return 'poor';
};

// ============================================================================
// CLASS METHODS (STATIC)
// ============================================================================

/**
 * Find active items by user
 */
Clothes.findActiveByUser = function(userId, options = {}) {
    return this.findAll({
        where: {
            userId,
            isActive: true
        },
        ...options
    });
};

/**
 * Find by type
 */
Clothes.findByType = function(userId, type, options = {}) {
    return this.findAll({
        where: {
            userId,
            type,
            isActive: true
        },
        ...options
    });
};

/**
 * Find by season
 */
Clothes.findBySeason = function(userId, season, options = {}) {
    return this.findAll({
        where: {
            userId,
            season: {
                [Op.like]: `%${season}%` // Handle comma-separated seasons
            },
            isActive: true
        },
        ...options
    });
};

/**
 * Get most worn items
 */
Clothes.getMostWorn = function(userId, limit = 10) {
    return this.findAll({
        where: {
            userId,
            isActive: true
        },
        order: [['wear_count', 'DESC']],
        limit
    });
};

/**
 * Get least worn items
 */
Clothes.getLeastWorn = function(userId, limit = 10) {
    return this.findAll({
        where: {
            userId,
            isActive: true
        },
        order: [['wear_count', 'ASC']],
        limit
    });
};

// ============================================================================
// NEW AI-SPECIFIC CLASS METHODS
// ============================================================================

/**
 * Find items needing manual review
 */
Clothes.findNeedingReview = function(userId, options = {}) {
    return this.findAll({
        where: {
            userId,
            isActive: true,
            needsManualReview: true
        },
        order: [['created_at', 'DESC']],
        ...options
    });
};

/**
 * Find items with low AI confidence
 */
Clothes.findLowConfidence = function(userId, threshold = 0.7, options = {}) {
    return this.findAll({
        where: {
            userId,
            isActive: true,
            aiConfidenceScore: {
                [Op.lt]: threshold
            }
        },
        order: [['ai_confidence_score', 'ASC']],
        ...options
    });
};

/**
 * Get AI tagging statistics for a user
 */
Clothes.getAIStats = async function(userId) {
    const items = await this.findAll({
        where: { userId, isActive: true },
        attributes: ['aiGeneratedTags', 'aiConfidenceScore', 'needsManualReview', 'aiMetadata']
    });
    
    const stats = {
        total: items.length,
        aiGenerated: items.filter(i => i.aiGeneratedTags).length,
        manuallyTagged: items.filter(i => !i.aiGeneratedTags).length,
        needingReview: items.filter(i => i.needsManualReview).length,
        averageConfidence: 0,
        byProvider: {}
    };
    
    // Calculate average confidence
    const confidenceItems = items.filter(i => i.aiConfidenceScore);
    if (confidenceItems.length > 0) {
        stats.averageConfidence = confidenceItems.reduce((sum, i) => sum + parseFloat(i.aiConfidenceScore), 0) / confidenceItems.length;
    }
    
    // Count by provider
    items.forEach(item => {
        if (item.aiMetadata && item.aiMetadata.provider) {
            stats.byProvider[item.aiMetadata.provider] = (stats.byProvider[item.aiMetadata.provider] || 0) + 1;
        }
    });
    
    return stats;
};

/**
 * Find items tagged by specific AI provider
 */
Clothes.findByAIProvider = function(userId, provider, options = {}) {
    return this.findAll({
        where: {
            userId,
            isActive: true,
            aiMetadata: {
                provider: provider
            }
        },
        ...options
    });
};



// Outfit Model
const Outfit = sequelize.define('Outfit', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: 'Unique identifier for the outfit'
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: {
            model: 'users',
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Reference to the user who owns this outfit'
    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: {
                msg: 'Outfit name cannot be empty'
            }
        },
        comment: 'User-defined name for the outfit'
    },
    occasion: {
        type: DataTypes.STRING(100),
        validate: {
            isIn: {
                args: [['casual', 'formal', 'business', 'athletic', 'party', 'date', 'outdoor', 'beach', 'wedding', 'travel', null]],
                msg: 'Invalid occasion type'
            }
        },
        comment: 'Occasion type for this outfit'
    },
    items: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        validate: {
            isValidArray(value) {
                if (!Array.isArray(value)) {
                    throw new Error('Items must be an array');
                }
                if (value.length === 0) {
                    throw new Error('At least one item is required');
                }
            }
        },
        comment: 'Array of clothing item IDs'
    },
    isSuggested: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
        field: 'is_suggested',
        comment: 'Whether AI-suggested or manual'
    },
    isFavorite: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
        field: 'is_favorite',
        comment: 'Favorite status'
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        field: 'is_active',
        comment: 'Soft delete flag'
    },
    wearCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
        field: 'wear_count',
        validate: {
            min: { args: [0], msg: 'Wear count cannot be negative' }
        },
        comment: 'Times worn'
    },
    lastWornAt: {
        type: DataTypes.DATE,
        field: 'last_worn_at',
        comment: 'Last wear timestamp'
    },
    notes: {
        type: DataTypes.TEXT,
        comment: 'Additional notes'
    },
    season: {
        type: DataTypes.STRING(50),
        validate: {
            isIn: {
                args: [['spring', 'summer', 'fall', 'winter', 'all-season', null]],
                msg: 'Invalid season'
            }
        },
        comment: 'Appropriate season'
    },
    weatherCondition: {
        type: DataTypes.STRING(50),
        field: 'weather_condition',
        comment: 'Weather suitability'
    },
    imageUrl: {
        type: DataTypes.STRING(500),
        field: 'image_url',
        comment: 'Outfit image URL'
    },
    tags: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: 'Tags for categorization'
    },
    colorPalette: {
        type: DataTypes.JSONB,
        field: 'color_palette',
        defaultValue: [],
        comment: 'Dominant colors'
    },
    rating: {
        type: DataTypes.DECIMAL(2, 1),
        validate: {
            min: { args: [0] },
            max: { args: [5] }
        },
        comment: 'User rating (0-5)'
    },
    aiConfidenceScore: {
        type: DataTypes.DECIMAL(3, 2),
        field: 'ai_confidence_score',
        comment: 'AI confidence (0-1)'
    }
}, {
    tableName: 'outfits',
    indexes: [
        { name: 'idx_outfits_user_id', fields: ['user_id'] },
        { name: 'idx_outfits_created_at', fields: ['created_at'] },
        { name: 'idx_outfits_occasion', fields: ['occasion'] },
        { name: 'idx_outfits_is_favorite', fields: ['is_favorite'] },
        { name: 'idx_outfits_is_active', fields: ['is_active'] },
        { name: 'idx_outfits_user_active', fields: ['user_id', 'is_active'] },
        { name: 'idx_outfits_wear_count', fields: ['wear_count'] },
        { name: 'idx_outfits_season', fields: ['season'] }
    ],
    hooks: {
        beforeValidate: (outfit) => {
            if (outfit.name) outfit.name = outfit.name.trim();
            if (outfit.occasion) outfit.occasion = outfit.occasion.trim();
        }
    }
});

// Add instance methods
Outfit.prototype.markAsWorn = async function(wornAt = new Date()) {
    this.wearCount += 1;
    this.lastWornAt = wornAt;
    await this.save();
    return this;
};

Outfit.prototype.toggleFavorite = async function() {
    this.isFavorite = !this.isFavorite;
    await this.save();
    return this;
};

// Add class methods
Outfit.findActiveByUser = function(userId, options = {}) {
    return this.findAll({ where: { userId, isActive: true }, ...options });
};

Outfit.findFavorites = function(userId, options = {}) {
    return this.findAll({ where: { userId, isFavorite: true, isActive: true }, ...options });
};


//Trips Model - UPDATED TO PRODUCTION-READY VERSION
const Trip = sequelize.define('Trip', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: 'Unique identifier for the trip'
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: {
            model: 'users',
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Reference to user'
    },
    destination: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: { msg: 'Destination cannot be empty' }
        },
        comment: 'Full destination'
    },
    city: {
        type: DataTypes.STRING(100),
        comment: 'Destination city'
    },
    country: {
        type: DataTypes.STRING(100),
        comment: 'Destination country'
    },
    startDate: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'start_date',
        comment: 'Trip start date'
    },
    endDate: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'end_date',
        validate: {
            isAfterStartDate(value) {
                if (this.startDate && value <= this.startDate) {
                    throw new Error('End date must be after start date');
                }
            }
        },
        comment: 'Trip end date'
    },
    durationDays: {
        type: DataTypes.INTEGER,
        field: 'duration_days',
        comment: 'Duration in days'
    },
    purpose: {
        type: DataTypes.STRING(100),
        defaultValue: 'leisure',
        validate: {
            isIn: {
                args: [['leisure', 'business', 'family', 'adventure', 'honeymoon', 'solo', 'group', 'other']],
                msg: 'Invalid purpose'
            }
        },
        comment: 'Trip purpose'
    },
    tripType: {
        type: DataTypes.STRING(100),
        field: 'trip_type',
        comment: 'Type (domestic/international)'
    },
    status: {
        type: DataTypes.ENUM('upcoming', 'active', 'completed', 'cancelled'),
        defaultValue: 'upcoming',
        allowNull: false,
        comment: 'Current status'
    },
    budget: {
        type: DataTypes.DECIMAL(10, 2),
        comment: 'Trip budget'
    },
    accommodation: {
        type: DataTypes.STRING(255),
        comment: 'Accommodation details'
    },
    transportation: {
        type: DataTypes.STRING(255),
        comment: 'Transportation method'
    },
    companions: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        comment: 'Number of travelers'
    },
    weatherSummary: {
        type: DataTypes.TEXT,
        field: 'weather_summary',
        comment: 'Weather summary'
    },
    weatherData: {
        type: DataTypes.JSONB,
        field: 'weather_data',
        comment: 'Detailed weather'
    },
    packingList: {
        type: DataTypes.JSONB,
        field: 'packing_list',
        comment: 'AI packing list'
    },
    recommendedOutfits: {
        type: DataTypes.JSONB,
        field: 'recommended_outfits',
        defaultValue: [],
        comment: 'Recommended outfits'
    },
    notes: {
        type: DataTypes.TEXT,
        comment: 'Additional notes'
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        field: 'is_active',
        comment: 'Soft delete flag'
    },
    checklist: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: 'Trip checklist'
    },
    completedAt: {
        type: DataTypes.DATE,
        field: 'completed_at',
        comment: 'Completion timestamp'
    },
    rating: {
        type: DataTypes.DECIMAL(2, 1),
        validate: {
            min: { args: [0] },
            max: { args: [5] }
        },
        comment: 'User rating (0-5)'
    },
    activities: {
        // Phase 3 fix: createTrip() has always parsed and used this, but
        // the column never existed -- Sequelize silently dropped it on
        // every .create() call. See migration
        // 20260919000001-add-activities-to-trips.
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: [],
        comment: 'Parsed day-by-day activities: [{date, slots: [{time, occasion}]}]'
    },
    luggageConstraints: {
        // Phase 4: previously an ephemeral request override only --
        // regeneratePackingList() silently fell back to a hardcoded
        // tripType preset (_getDefaultLuggageConstraints) on every
        // regenerate unless the caller resent the same override every
        // time. Persisting the constraints actually used means the
        // user's real choice (a specific maxItems, or a multi-bag split
        // via `bags: [{name, type, maxItems}]`) is remembered. See
        // migration 20260920000002-add-luggage-constraints-to-trips.
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'luggage_constraints',
        defaultValue: null,
        comment: 'e.g. {type, maxItems} or {bags: [{name, type, maxItems}]}'
    },
    // Phase 7 (Trip Activities & Places, PRD §3.8)
    planningMode: {
        type: DataTypes.STRING(20),
        field: 'planning_mode',
        validate: { isIn: { args: [['mode_a', 'mode_b', null]] } },
        comment: 'mode_a (destination-anchored) | mode_b (open-ended leisure) -- null for trips not using activity planning'
    },
    totalBudget: {
        type: DataTypes.DECIMAL(10, 2),
        field: 'total_budget'
    },
    budgetCurrency: {
        type: DataTypes.STRING(3),
        field: 'budget_currency'
    }
}, {
    tableName: 'trips',
    indexes: [
        { name: 'idx_trips_user_id', fields: ['user_id'] },
        { name: 'idx_trips_created_at', fields: ['created_at'] },
        { name: 'idx_trips_start_date', fields: ['start_date'] },
        { name: 'idx_trips_end_date', fields: ['end_date'] },
        { name: 'idx_trips_status', fields: ['status'] },
        { name: 'idx_trips_is_active', fields: ['is_active'] },
        { name: 'idx_trips_user_active', fields: ['user_id', 'is_active'] },
        { name: 'idx_trips_user_dates', fields: ['user_id', 'start_date', 'end_date'] }
    ],
    hooks: {
        beforeValidate: (trip) => {
            if (trip.destination) trip.destination = trip.destination.trim();
            if (trip.startDate && trip.endDate) {
                const start = new Date(trip.startDate);
                const end = new Date(trip.endDate);
                trip.durationDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            }
        }
    }
});

// Add instance methods
Trip.prototype.updateStatus = async function() {
    const now = new Date();
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);
    let newStatus = start > now ? 'upcoming' : (end < now ? 'completed' : 'active');
    if (newStatus !== this.status && this.status !== 'cancelled') {
        await this.update({ status: newStatus });
    }
    return this;
};

Trip.prototype.markAsCompleted = async function() {
    await this.update({ status: 'completed', completedAt: new Date() });
    return this;
};

// Add class methods
Trip.findUpcoming = function(userId, options = {}) {
    const { Op } = require('sequelize');
    return this.findAll({
        where: { userId, isActive: true, startDate: { [Op.gt]: new Date() } },
        order: [['startDate', 'ASC']],
        ...options
    });
};

// Phase 3: schema-only per the roadmap ("scaffolded — not used yet") --
// no controller/service reads or writes these. trips.activities (JSONB,
// above) remains the real source the packing algorithm and auto-replan
// job read.
const TripActivity = sequelize.define('TripActivity', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    tripId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'trip_id',
        references: { model: 'trips', key: 'id' }
    },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    timeSlot: { type: DataTypes.STRING(50), field: 'time_slot' },
    occasion: { type: DataTypes.STRING(100) },
    title: { type: DataTypes.STRING(255) },
    notes: { type: DataTypes.TEXT },
    // Phase 7 additions (PRD §3.8) -- activates this from schema-only
    // into a real entity. trips.activities (JSONB) remains the input
    // spec the packing algorithm reads; these rows are the richer,
    // queryable object Places/budget/outfit-linking attach to.
    category: { type: DataTypes.STRING(50) },
    placeId: { type: DataTypes.STRING(255), field: 'place_id' },
    locationText: { type: DataTypes.STRING(255), field: 'location_text' },
    estimatedCost: { type: DataTypes.DECIMAL(10, 2), field: 'estimated_cost' },
    categoryBudgetTag: {
        type: DataTypes.STRING(50),
        field: 'category_budget_tag',
        validate: { isIn: { args: [['accommodation', 'food', 'activities', null]] } }
    },
    linkedOutfitId: { type: DataTypes.UUID, field: 'linked_outfit_id' },
    status: {
        type: DataTypes.STRING(20),
        defaultValue: 'planned',
        validate: { isIn: { args: [['planned', 'confirmed', 'skipped', 'replaced']] } }
    }
}, {
    tableName: 'trip_activities'
});

const TripParticipant = sequelize.define('TripParticipant', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    tripId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'trip_id',
        references: { model: 'trips', key: 'id' }
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'user_id',
        references: { model: 'users', key: 'id' }
    },
    name: { type: DataTypes.STRING(255) },
    email: { type: DataTypes.STRING(255) },
    role: { type: DataTypes.STRING(50), defaultValue: 'companion' },
    // Phase 8 (PRD §3.9): invited | accepted | declined. Every Phase 8
    // participant is required to have a real account (2026-09-17
    // scoping decision) -- userId is set at invite time via an email
    // lookup, not left null pending a guest signup.
    status: {
        type: DataTypes.STRING(20),
        defaultValue: 'invited',
        validate: { isIn: { args: [['invited', 'accepted', 'declined']] } }
    }
}, {
    tableName: 'trip_participants'
});

// Phase 8 (PRD §3.9): cross-closet borrowing consent -- explicit,
// mutual, revocable, scoped by the owner's choice. Kept as three
// genuinely distinct scopes per the 2026-09-17 scoping decision.
const ClosetShare = sequelize.define('ClosetShare', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    ownerUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'owner_user_id',
        references: { model: 'users', key: 'id' }
    },
    recipientUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'recipient_user_id',
        references: { model: 'users', key: 'id' }
    },
    scope: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: { args: [['event_only', 'trip_only', 'full_wardrobe']] } }
    },
    scopedTripId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'scoped_trip_id',
        references: { model: 'trips', key: 'id' }
    },
    scopedActivityId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'scoped_activity_id',
        references: { model: 'trip_activities', key: 'id' }
    },
    status: {
        type: DataTypes.STRING(20),
        defaultValue: 'pending',
        validate: { isIn: { args: [['pending', 'active', 'revoked']] } }
    }
}, {
    tableName: 'closet_shares'
});

// Phase 8 (PRD §3.9): a coordinated or cross-closet-borrowed outfit for
// one shared trip activity. Trip- and activity-scoped for this phase
// (2026-09-17 scoping decision) -- the bare event_ref/no-trip case is
// deferred.
const GroupOutfit = sequelize.define('GroupOutfit', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    tripId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'trip_id',
        references: { model: 'trips', key: 'id' }
    },
    activityId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'activity_id',
        references: { model: 'trip_activities', key: 'id' }
    },
    mode: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: { args: [['coordinated', 'cross_closet']] } }
    },
    theme: { type: DataTypes.JSONB, allowNull: true },
    participantOutfits: { type: DataTypes.JSONB, defaultValue: [], field: 'participant_outfits' },
    items: { type: DataTypes.JSONB, defaultValue: [] },
    createdBy: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'created_by',
        references: { model: 'users', key: 'id' }
    }
}, {
    tableName: 'group_outfits'
});

// Phase 3: forecast-accuracy tracking -- see migration
// 20260919000003-create-weather-outcomes for the full rationale.
// Written by the nightly job in queues/tripMaintenanceQueue.js.
const WeatherOutcome = sequelize.define('WeatherOutcome', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    tripId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'trip_id',
        references: { model: 'trips', key: 'id' }
    },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    city: { type: DataTypes.STRING(100) },
    country: { type: DataTypes.STRING(100) },
    forecastTemp: { type: DataTypes.DECIMAL(5, 2), field: 'forecast_temp' },
    forecastCondition: { type: DataTypes.STRING(50), field: 'forecast_condition' },
    forecastPrecipitation: { type: DataTypes.DECIMAL(4, 3), field: 'forecast_precipitation' },
    forecastType: { type: DataTypes.STRING(50), field: 'forecast_type' },
    actualTemp: { type: DataTypes.DECIMAL(5, 2), field: 'actual_temp' },
    actualCondition: { type: DataTypes.STRING(50), field: 'actual_condition' },
    actualPrecipitation: { type: DataTypes.DECIMAL(4, 3), field: 'actual_precipitation' },
    tempDelta: { type: DataTypes.DECIMAL(5, 2), field: 'temp_delta' },
    conditionMatched: { type: DataTypes.BOOLEAN, field: 'condition_matched' },
    source: { type: DataTypes.STRING(50), defaultValue: 'open-meteo' },
    checkedAt: { type: DataTypes.DATE, field: 'checked_at' }
}, {
    tableName: 'weather_outcomes'
});

// Phase 4: permanent dedup store for observed (never-changing) historical
// weather, keyed by (city, country, date) -- shared across every trip and
// every user, unlike WeatherOutcome (Phase 3, per-trip). See migration
// 20260920000001-create-historical-weather-records for the full
// rationale. Read/written by historicalWeather.service.js.
const HistoricalWeatherRecord = sequelize.define('HistoricalWeatherRecord', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    city: { type: DataTypes.STRING(100), allowNull: false },
    country: { type: DataTypes.STRING(100), allowNull: true },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    latitude: { type: DataTypes.DECIMAL(8, 5), allowNull: true },
    longitude: { type: DataTypes.DECIMAL(8, 5), allowNull: true },
    temp: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
    condition: { type: DataTypes.STRING(50), allowNull: true },
    precipitation: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
    source: { type: DataTypes.STRING(50), defaultValue: 'open-meteo' },
    fetchedAt: { type: DataTypes.DATE, field: 'fetched_at' }
}, {
    tableName: 'historical_weather_records',
    indexes: [
        { name: 'idx_historical_weather_city_country_date', unique: true, fields: ['city', 'country', 'date'] }
    ]
});

//User Preferences Model - UPDATED TO PRODUCTION-READY VERSION
const UserPreferences = sequelize.define('UserPreferences', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        field: 'user_id',
        references: {
            model: 'users',
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    // Style
    stylePersona: {
        type: DataTypes.STRING(100),
        field: 'style_persona',
        validate: {
            isIn: {
                args: [['minimalist', 'classic', 'trendy', 'bohemian', 'preppy', 'streetwear', 'sporty', 'elegant', 'edgy', 'romantic', null]]
            }
        }
    },
    preferredColors: {
        type: DataTypes.JSONB,
        field: 'preferred_colors',
        defaultValue: []
    },
    avoidColors: {
        type: DataTypes.JSONB,
        field: 'avoid_colors',
        defaultValue: []
    },
    preferredFabrics: {
        type: DataTypes.JSONB,
        field: 'preferred_fabrics',
        defaultValue: []
    },
    avoidFabrics: {
        type: DataTypes.JSONB,
        field: 'avoid_fabrics',
        defaultValue: []
    },
    preferredBrands: {
        type: DataTypes.JSONB,
        field: 'preferred_brands',
        defaultValue: []
    },
    occasionFrequency: {
        type: DataTypes.JSONB,
        field: 'occasion_frequency',
        defaultValue: {}
    },
    // Work/Schedule
    employmentStatus: {
        type: DataTypes.STRING(50),
        field: 'employment_status',
        defaultValue: 'not_specified',
        validate: {
            isIn: {
                args: [['employed_office', 'employed_remote', 'employed_hybrid', 'self_employed', 'student', 'retired', 'unemployed', 'not_specified']]
            }
        }
    },
    workSchedule: {
        type: DataTypes.JSONB,
        field: 'work_schedule',
        defaultValue: {}
    },
    workDresscode: {
        type: DataTypes.STRING(100),
        field: 'work_dresscode',
        validate: {
            isIn: {
                args: [['business_formal', 'business_casual', 'smart_casual', 'casual', 'creative', 'uniform', 'no_dresscode', null]]
            }
        }
    },
    workdays: {
        type: DataTypes.JSONB,
        defaultValue: []
    },
    // Body & Fit
    bodyType: {
        type: DataTypes.STRING(50),
        field: 'body_type',
        validate: {
            isIn: {
                args: [['rectangle', 'triangle', 'inverted_triangle', 'hourglass', 'oval', null]]
            }
        }
    },
    fitPreference: {
        type: DataTypes.STRING(50),
        field: 'fit_preference',
        defaultValue: 'regular'
    },
    sizes: {
        type: DataTypes.JSONB,
        defaultValue: {}
    },
    // Phase 5 (Gap-to-Purchase Funnel, PRD §3.14) -- affiliate-region
    // fallback when no trip is active. Free-text, matching Trip.country's
    // existing convention rather than introducing strict ISO codes here.
    homeRegion: {
        type: DataTypes.STRING(100),
        field: 'home_region',
    },
    // Phase 7 (Trip Activities & Places, PRD §3.8) -- travel-specific
    // interest profile feeding Mode A/B planning. Distinct from the
    // style preferences above: related but separate signal (itinerary
    // shape, not outfit choice).
    cuisinePreferences: {
        type: DataTypes.JSONB,
        field: 'cuisine_preferences',
        defaultValue: []
    },
    activityCategories: {
        type: DataTypes.JSONB,
        field: 'activity_categories',
        defaultValue: []
    },
    pacePreference: {
        type: DataTypes.STRING(20),
        field: 'pace_preference',
        validate: { isIn: { args: [['packed', 'relaxed', 'balanced', null]] } }
    },
    // Lifestyle
    climate: {
        type: DataTypes.STRING(50)
    },
    activities: {
        type: DataTypes.JSONB,
        defaultValue: []
    },
    lifestyle: {
        type: DataTypes.STRING(100)
    },
    budget: {
        type: DataTypes.STRING(50)
    },
    shoppingFrequency: {
        type: DataTypes.STRING(50),
        field: 'shopping_frequency'
    },
    sustainabilityPreference: {
        type: DataTypes.STRING(50),
        field: 'sustainability_preference'
    },
    ageRange: {
        type: DataTypes.STRING(20),
        field: 'age_range'
    },
    gender: {
        type: DataTypes.STRING(50)
    },
    notificationPreferences: {
        type: DataTypes.JSONB,
        field: 'notification_preferences',
        defaultValue: {
            outfitSuggestions: true,
            weatherAlerts: true,
            tripReminders: true
        }
    },
    notes: {
        type: DataTypes.TEXT
    }
}, {
    tableName: 'user_preferences',
    indexes: [
        { name: 'idx_user_preferences_user_id', unique: true, fields: ['user_id'] },
        { name: 'idx_user_preferences_style', fields: ['style_persona'] }
    ],
    hooks: {
        beforeValidate: (prefs) => {
            if (prefs.stylePersona) prefs.stylePersona = prefs.stylePersona.trim();
            if (prefs.workdays && Array.isArray(prefs.workdays)) {
                prefs.workdays = prefs.workdays.map(day => day.toLowerCase());
            }
        }
    }
});

// Instance methods
UserPreferences.prototype.calculateCompleteness = function() {
    const fields = ['stylePersona', 'preferredColors', 'employmentStatus', 'workDresscode', 'bodyType', 'climate'];
    let completed = fields.filter(f => this[f] && this[f] !== 'not_specified').length;
    return Math.round((completed / fields.length) * 100);
};

UserPreferences.prototype.isWorkday = function(date = new Date()) {
    if (!this.workdays?.length) return false;
    const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'lowercase' });
    return this.workdays.includes(dayOfWeek);
};

// Class methods
UserPreferences.findByUserId = function(userId) {
    return this.findOne({ where: { userId } });
};

//User Interaction
const UserInteraction = sequelize.define('UserInteraction', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: { model: 'users', key: 'id' }
    },
    itemId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'item_id',
        references: { model: 'clothes', key: 'id' },
        comment: 'Clothing item that was interacted with'
    },
    outfitId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'outfit_id',
        references: { model: 'outfits', key: 'id' },
        comment: 'Outfit that was interacted with'
    },
    action: {
        // Phase 1: 'correct' added for the manual tag-correction flow
        // (see migration 20260917000001) -- a distinct learning signal
        // from a like/save/wear, per the PRD.
        type: DataTypes.ENUM('view', 'like', 'dislike', 'save', 'share', 'wear', 'skip', 'correct'),
        allowNull: false,
        comment: 'Type of interaction'
    },
    durationSeconds: {
        type: DataTypes.INTEGER,
        field: 'duration_seconds',
        comment: 'How long user viewed the item/outfit'
    },
    context: {
        type: DataTypes.JSONB,
        comment: 'Context when interaction happened (weather, occasion, etc.)'
    }
}, {
    tableName: 'user_interactions',
    indexes: [
        { fields: ['user_id'] },
        { fields: ['created_at'] },
        { fields: ['action'] },
        { fields: ['user_id', 'action'] }
    ]
});

// Class method
UserInteraction.findByUserId = function(userId, limit = 5000) {
    return this.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
        limit
    });
};

// Outfit Rating model
const OutfitRating = sequelize.define('OutfitRating', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: { model: 'users', key: 'id' }
    },
    outfitId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'outfit_id',
        references: { model: 'outfits', key: 'id' }
    },
    overallRating: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'overall_rating',
        validate: {
            min: 1,
            max: 5
        },
        comment: 'Overall rating (1-5 stars)'
    },
    styleRating: {
        type: DataTypes.INTEGER,
        field: 'style_rating',
        validate: { min: 1, max: 5 }
    },
    comfortRating: {
        type: DataTypes.INTEGER,
        field: 'comfort_rating',
        validate: { min: 1, max: 5 }
    },
    review: {
        type: DataTypes.TEXT,
        comment: 'Optional written review'
    }
}, {
    tableName: 'outfit_ratings',
    indexes: [
        { fields: ['user_id'] },
        { fields: ['outfit_id'] },
        { fields: ['overall_rating'] }
    ]
});

// Class method
OutfitRating.findByUserId = function(userId) {
    return this.findAll({ where: { userId } });
};

//ClothesAttributes model
const ClothesAttributes = sequelize.define('ClothesAttributes', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    clothesId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        field: 'clothes_id',
        references: { model: 'clothes', key: 'id' }
    },
    neckline: {
        type: DataTypes.STRING(50),
        comment: 'Detected neckline style (crew, v-neck, etc.)'
    },
    sleeveLength: {
        type: DataTypes.STRING(50),
        field: 'sleeve_length',
        comment: 'Detected sleeve length (short, long, sleeveless)'
    },
    detectedBrand: {
        type: DataTypes.STRING(100),
        field: 'detected_brand',
        comment: 'Brand detected from image'
    },
    clipEmbedding: {
        type: DataTypes.JSONB,
        field: 'clip_embedding',
        comment: 'CLIP embedding vector for visual similarity'
    },
    styleEmbedding: {
        type: DataTypes.JSONB,
        field: 'style_embedding',
        comment: 'Style embedding vector'
    }
}, {
    tableName: 'clothes_attributes'
});


//RecommendationLog model
const RecommendationLog = sequelize.define('RecommendationLog', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: { model: 'users', key: 'id' }
    },
    occasion: {
        type: DataTypes.STRING(100),
        comment: 'Occasion for recommendation'
    },
    recommendedOutfits: {
        type: DataTypes.JSONB,
        field: 'recommended_outfits',
        comment: 'Array of recommended outfit IDs and scores'
    },
    context: {
        type: DataTypes.JSONB,
        comment: 'Context snapshot (weather, time, location)'
    },
    userPreferencesSnapshot: {
        type: DataTypes.JSONB,
        field: 'user_preferences_snapshot',
        comment: 'User preferences at time of recommendation'
    },
    modelVersion: {
        type: DataTypes.STRING(50),
        field: 'model_version',
        comment: 'ML model version used'
    },
    // Phase 5 (Gap-to-Purchase Funnel) -- a gap-purchase suggestion is
    // just another kind of recommendation event, logged alongside outfit
    // recommendations in this same table rather than a new one. Defaults
    // to 'outfit' so every pre-Phase-5 row (and every existing write in
    // AIOutfit recommendation.js) keeps its current meaning unchanged --
    // see outfitAnalytics.service.js's swap-detection query, which now
    // explicitly filters recommendationType: 'outfit' so a gap-purchase
    // row created later in the day never gets mistaken for "today's
    // outfit recommendation."
    recommendationType: {
        type: DataTypes.ENUM('outfit', 'gap_purchase'),
        allowNull: false,
        defaultValue: 'outfit',
        field: 'recommendation_type',
    },
    funnelStage: {
        type: DataTypes.ENUM('suggested', 'clicked', 'purchased', 'worn'),
        field: 'funnel_stage',
        comment: 'Only meaningful for recommendationType = gap_purchase',
    },
    gapDetails: {
        type: DataTypes.JSONB,
        field: 'gap_details',
        comment: 'Descriptive gap spec: category, attributes (color/warmth/etc), reason',
    },
    tripId: {
        type: DataTypes.UUID,
        field: 'trip_id',
        references: { model: 'trips', key: 'id' },
    },
    urgency: {
        type: DataTypes.ENUM('purchase_eligible', 'too_urgent'),
        comment: 'Result of the days-until-needed vs shipping-lead-time check',
    },
    region: {
        type: DataTypes.STRING(100),
        comment: 'Resolved region (free-text country name, e.g. "United Kingdom" -- see region.service.js) used to pick the affiliate link',
    },
    affiliateNetwork: {
        type: DataTypes.STRING(50),
        field: 'affiliate_network',
        comment: 'e.g. "skimlinks", "awin", or "mock" when built credential-gated with no live key',
    },
    affiliateLink: {
        type: DataTypes.TEXT,
        field: 'affiliate_link',
    },
    matchedProduct: {
        type: DataTypes.JSONB,
        field: 'matched_product',
        comment: 'Set once product-feed style matching finds a specific SKU; null for a v1 search-results-page link',
    },
    clickedAt: {
        type: DataTypes.DATE,
        field: 'clicked_at',
    },
    purchasedAt: {
        type: DataTypes.DATE,
        field: 'purchased_at',
    },
    purchaseSelfReported: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: 'purchase_self_reported',
        comment: 'true if filled by the "did you buy it?" check-in rather than network conversion reconciliation',
    },
    wornAt: {
        type: DataTypes.DATE,
        field: 'worn_at',
    },
}, {
    tableName: 'recommendation_logs',
    indexes: [
        { fields: ['user_id'] },
        { fields: ['created_at'] },
        { fields: ['recommendation_type', 'funnel_stage'] },
        { fields: ['trip_id'] },
    ]
});


//fashionTrends model
const FashionTrends = sequelize.define('FashionTrends', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    trendType: {
        type: DataTypes.ENUM('color', 'style', 'pattern', 'fabric'),
        allowNull: false,
        field: 'trend_type'
    },
    trendValue: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'trend_value',
        comment: 'The actual trend (e.g., "burgundy", "oversized")'
    },
    popularityScore: {
        type: DataTypes.DECIMAL(3, 2),
        field: 'popularity_score',
        comment: 'Trend popularity (0-1)'
    },
    season: {
        type: DataTypes.STRING(20),
        comment: 'Which season this trend is for'
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: 'is_active'
    }
}, {
    tableName: 'fashion_trends',
    indexes: [
        { fields: ['trend_type'] },
        { fields: ['is_active'] },
        { fields: ['season'] }
    ]
});

// Class method
FashionTrends.getCurrentTrends = function() {
    return this.findAll({
        where: { isActive: true },
        order: [['popularityScore', 'DESC']]
    });
};

// Phase 2: snapshot table for NeuralPreferenceLearner's output (see
// migration 20260918000001-create-learned-preferences.js for the full
// rationale). One row per user, upserted by the nightly learning job.
const LearnedPreferences = sequelize.define('LearnedPreferences', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        field: 'user_id',
        references: { model: 'users', key: 'id' }
    },
    preferences: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    embedding: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    interactionCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'interaction_count'
    },
    isColdStart: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_cold_start'
    },
    modelVersion: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: 'model_version'
    },
    lastLearnedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_learned_at'
    }
}, {
    tableName: 'learned_preferences'
});

// Phase 9 (PRD §3.10): the digital life-twin's persisted output. See
// migration 20260925000001-create-user-profile-summaries for the full
// rationale behind keeping structuredTraits (always the live, real
// computation) and userCorrections (the separate override/suppression
// overlay, applied at read time by each consumer) as two distinct
// columns rather than baking corrections into the trait values.
const UserProfileSummary = sequelize.define('UserProfileSummary', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        field: 'user_id',
        references: { model: 'users', key: 'id' }
    },
    version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    computedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'computed_at'
    },
    structuredTraits: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'structured_traits'
    },
    narrativeSummary: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'narrative_summary'
    },
    narrativeGeneratedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'narrative_generated_at'
    },
    userCorrections: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'user_corrections'
    }
}, {
    tableName: 'user_profile_summaries'
});

// Phase 5: local mirror of affiliate network product feeds (see
// migration 20260922000001-create-product-feed-items.js for the full
// rationale -- feeds are bulk downloads, not a live search API, so
// style-aware product matching queries this table rather than calling
// out to a network per recommendation). Populated by
// productFeed.service.js's runProductFeedIngestion(), credential-gated
// to a local mock feed until a real direct network is configured.
const ProductFeedItem = sequelize.define('ProductFeedItem', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    network: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: '"mock" until a real direct network is added; then e.g. "awin", "cj"',
    },
    externalId: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'external_id',
        comment: 'The network/merchant\'s own product id -- dedup key together with network',
    },
    merchantName: {
        type: DataTypes.STRING(150),
        field: 'merchant_name',
    },
    title: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    description: DataTypes.TEXT,
    rawCategory: {
        type: DataTypes.STRING(150),
        field: 'raw_category',
        comment: 'Category string exactly as the feed gave it, pre-normalization',
    },
    category: {
        type: DataTypes.STRING(20),
        comment: 'Normalized to our own wardrobe categories; null if unrecognized',
    },
    brand: DataTypes.STRING(100),
    color: {
        type: DataTypes.STRING(50),
        comment: 'Merchant-dependent -- a soft ranking signal, never a hard filter',
    },
    styleTags: {
        type: DataTypes.JSONB,
        field: 'style_tags',
    },
    price: DataTypes.DECIMAL(10, 2),
    currency: DataTypes.STRING(3),
    imageUrl: {
        type: DataTypes.TEXT,
        field: 'image_url',
    },
    productUrl: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'product_url',
    },
    deepLink: {
        type: DataTypes.TEXT,
        field: 'deep_link',
    },
    region: DataTypes.STRING(100),
    feedFetchedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'feed_fetched_at',
    },
}, {
    tableName: 'product_feed_items',
    indexes: [
        { fields: ['network', 'external_id'], unique: true },
        { fields: ['category', 'region'] },
    ]
});

// Define Associations
User.hasMany(Clothes,{foreignKey: 'user_id'});
Clothes.belongsTo(User,{foreignKey: 'user_id'});

User.hasMany(Outfit,{foreignKey: 'user_id'});
Outfit.belongsTo(User,{foreignKey: 'user_id'});

User.hasMany(Trip,{foreignKey: 'user_id'});
Trip.belongsTo(User,{foreignKey: 'user_id'});

// Phase 2 fix (found live once tripModeManager's cron was actually
// wired up in server.js -- see that fix's own comment): this alias
// didn't exist at all. tripModeManager.service.js's deactivateEndedTrips
// does `User.findAll({ include: [{ model: Trip, as: 'activeTrip' }] })`
// and expects `user.activeTrip`, but with no such association defined
// Sequelize throws "You've included an alias (activeTrip), but it does
// not match the alias(es) defined in your association" on every call --
// caught by that method's own try/catch, so it never crashed the
// process, but it also meant not one ended trip has ever actually been
// auto-completed by that job. `active_trip_id` on User already points
// at a Trip row, so this is a straightforward belongsTo.
User.belongsTo(Trip, { foreignKey: 'active_trip_id', as: 'activeTrip' });

User.hasOne(UserPreferences,{foreignKey: 'user_id'});
UserPreferences.belongsTo(User,{foreignKey: 'user_id'});

User.hasMany(UserInteraction, {foreignKey: 'user_id'});
UserInteraction.belongsTo(User, {foreignKey: 'user_id'});
Clothes.hasMany(UserInteraction, {foreignKey: 'item_id'});
Outfit.hasMany(UserInteraction, {foreignKey: 'outfit_id'});

User.hasMany(OutfitRating, {foreignKey: 'user_id'});
Outfit.hasMany(OutfitRating, {foreignKey: 'outfit_id'});

Clothes.hasOne(ClothesAttributes, {foreignKey: 'clothes_id'});

User.hasOne(LearnedPreferences, {foreignKey: 'user_id'});
LearnedPreferences.belongsTo(User, {foreignKey: 'user_id'});

// Phase 9 (PRD §3.10)
User.hasOne(UserProfileSummary, {foreignKey: 'user_id'});
UserProfileSummary.belongsTo(User, {foreignKey: 'user_id'});

// Phase 7 (Trip Activities, Places, Destination Intelligence & Budgeting,
// PRD §3.8/§3.15) -- new models. See feature-roadmap-tracker.md Phase 7.

const Outing = sequelize.define('Outing', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
    title: { type: DataTypes.STRING(255), allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    timeSlot: { type: DataTypes.STRING(50), field: 'time_slot' },
    occasion: { type: DataTypes.STRING(100) },
    category: { type: DataTypes.STRING(50) },
    placeId: { type: DataTypes.STRING(255), field: 'place_id' },
    locationText: { type: DataTypes.STRING(255), field: 'location_text' },
    budgetAmount: { type: DataTypes.DECIMAL(10, 2), field: 'budget_amount' },
    budgetCurrency: { type: DataTypes.STRING(3), field: 'budget_currency' },
    linkedOutfitId: { type: DataTypes.UUID, field: 'linked_outfit_id' },
    status: {
        type: DataTypes.STRING(20),
        defaultValue: 'planned',
        validate: { isIn: { args: [['planned', 'completed', 'skipped']] } }
    }
}, {
    tableName: 'outings'
});

// The PERMANENT, ToS-compliant slice of the Places cache -- place_id +
// coordinates only. See migration 20260923000001-create-place-cache and
// places.service.js for the compliance rationale.
const PlaceCache = sequelize.define('PlaceCache', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    placeId: { type: DataTypes.STRING(255), allowNull: false, unique: true, field: 'place_id' },
    latitude: { type: DataTypes.DECIMAL(9, 6) },
    longitude: { type: DataTypes.DECIMAL(9, 6) },
    queryKey: { type: DataTypes.STRING(255), field: 'query_key' },
    firstSeenAt: { type: DataTypes.DATE, field: 'first_seen_at', defaultValue: DataTypes.NOW }
}, {
    tableName: 'place_cache'
});

const DestinationCulture = sequelize.define('DestinationCulture', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    country: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    summary: { type: DataTypes.TEXT },
    nativeToForeignerNotes: { type: DataTypes.TEXT, field: 'native_to_foreigner_notes' },
    lastUpdated: { type: DataTypes.DATE, field: 'last_updated' }
}, {
    tableName: 'destination_culture'
});

// Ingested from the FCDO -> Canada -> Smartraveller fallback chain --
// see destinationAdvisory.service.js. No LLM anywhere in that pipeline.
const DestinationAdvisory = sequelize.define('DestinationAdvisory', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    country: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    source: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: { args: [['fcdo', 'canada', 'smartraveller']] } }
    },
    riskLevel: { type: DataTypes.STRING(20), field: 'risk_level' },
    summary: { type: DataTypes.TEXT },
    categories: { type: DataTypes.JSONB },
    sourceUrl: { type: DataTypes.TEXT, field: 'source_url' },
    fetchedAt: { type: DataTypes.DATE, allowNull: false, field: 'fetched_at' }
}, {
    tableName: 'destination_advisories'
});

// Curated cost-of-living table backing the budget feasibility check --
// own data, not Numbeo's paid API. See budgetFeasibility.service.js.
const DestinationCostTier = sequelize.define('DestinationCostTier', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    countryOrRegion: { type: DataTypes.STRING(100), allowNull: false, field: 'country_or_region' },
    tier: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: { args: [['budget', 'mid', 'comfortable']] } }
    },
    dailyAccommodation: { type: DataTypes.DECIMAL(10, 2), field: 'daily_accommodation' },
    dailyFood: { type: DataTypes.DECIMAL(10, 2), field: 'daily_food' },
    dailyLocalTransport: { type: DataTypes.DECIMAL(10, 2), field: 'daily_local_transport' },
    dailyActivities: { type: DataTypes.DECIMAL(10, 2), field: 'daily_activities' },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
    sourceNote: { type: DataTypes.STRING(255), field: 'source_note' },
    lastUpdated: { type: DataTypes.DATE, field: 'last_updated' }
}, {
    tableName: 'destination_cost_tiers'
});

const BudgetReminder = sequelize.define('BudgetReminder', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
    tripId: { type: DataTypes.UUID, field: 'trip_id' },
    outingId: { type: DataTypes.UUID, field: 'outing_id' },
    itemDescription: { type: DataTypes.STRING(255), allowNull: false, field: 'item_description' },
    triggerType: {
        type: DataTypes.STRING(20),
        defaultValue: 'trip_active',
        field: 'trigger_type',
        validate: { isIn: { args: [['trip_active', 'specific_date']] } }
    },
    triggerDate: { type: DataTypes.DATEONLY, field: 'trigger_date' },
    status: {
        type: DataTypes.STRING(20),
        defaultValue: 'pending',
        validate: { isIn: { args: [['pending', 'sent', 'dismissed']] } }
    },
    sentAt: { type: DataTypes.DATE, field: 'sent_at' }
}, {
    tableName: 'budget_reminders'
});

// Phase 3
Trip.hasMany(TripActivity, {foreignKey: 'trip_id'});
TripActivity.belongsTo(Trip, {foreignKey: 'trip_id'});

Trip.hasMany(TripParticipant, {foreignKey: 'trip_id'});
TripParticipant.belongsTo(Trip, {foreignKey: 'trip_id'});

Trip.hasMany(WeatherOutcome, {foreignKey: 'trip_id'});
WeatherOutcome.belongsTo(Trip, {foreignKey: 'trip_id'});

// Phase 7
User.hasMany(Outing, {foreignKey: 'user_id'});
Outing.belongsTo(User, {foreignKey: 'user_id'});

User.hasMany(BudgetReminder, {foreignKey: 'user_id'});
BudgetReminder.belongsTo(User, {foreignKey: 'user_id'});
Trip.hasMany(BudgetReminder, {foreignKey: 'trip_id'});
BudgetReminder.belongsTo(Trip, {foreignKey: 'trip_id'});
Outing.hasMany(BudgetReminder, {foreignKey: 'outing_id'});
BudgetReminder.belongsTo(Outing, {foreignKey: 'outing_id'});

// Phase 8
User.hasMany(TripParticipant, {foreignKey: 'user_id'});
TripParticipant.belongsTo(User, {foreignKey: 'user_id'});

User.hasMany(ClosetShare, {foreignKey: 'owner_user_id', as: 'closetSharesOwned'});
ClosetShare.belongsTo(User, {foreignKey: 'owner_user_id', as: 'owner'});
User.hasMany(ClosetShare, {foreignKey: 'recipient_user_id', as: 'closetSharesReceived'});
ClosetShare.belongsTo(User, {foreignKey: 'recipient_user_id', as: 'recipient'});
Trip.hasMany(ClosetShare, {foreignKey: 'scoped_trip_id'});
ClosetShare.belongsTo(Trip, {foreignKey: 'scoped_trip_id'});
TripActivity.hasMany(ClosetShare, {foreignKey: 'scoped_activity_id'});
ClosetShare.belongsTo(TripActivity, {foreignKey: 'scoped_activity_id'});

Trip.hasMany(GroupOutfit, {foreignKey: 'trip_id'});
GroupOutfit.belongsTo(Trip, {foreignKey: 'trip_id'});
TripActivity.hasMany(GroupOutfit, {foreignKey: 'activity_id'});
GroupOutfit.belongsTo(TripActivity, {foreignKey: 'activity_id'});
User.hasMany(GroupOutfit, {foreignKey: 'created_by'});
GroupOutfit.belongsTo(User, {foreignKey: 'created_by'});


module.exports = {
    sequelize,
    User,
    Clothes,
    Outfit,
    Trip,
    UserPreferences,
    UserInteraction,
    OutfitRating,
    ClothesAttributes,
    RecommendationLog,
    FashionTrends,
    LearnedPreferences,
    TripActivity,
    TripParticipant,
    WeatherOutcome,
    HistoricalWeatherRecord,
    ProductFeedItem,
    Outing,
    PlaceCache,
    DestinationCulture,
    DestinationAdvisory,
    DestinationCostTier,
    BudgetReminder,
    ClosetShare,
    GroupOutfit,
    UserProfileSummary
};
