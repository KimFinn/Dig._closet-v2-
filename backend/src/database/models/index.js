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
        type: DataTypes.ENUM('view', 'like', 'dislike', 'save', 'share', 'wear', 'skip'),
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
    }
}, {
    tableName: 'recommendation_logs',
    indexes: [
        { fields: ['user_id'] },
        { fields: ['created_at'] }
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

// Define Associations
User.hasMany(Clothes,{foreignKey: 'user_id'});
Clothes.belongsTo(User,{foreignKey: 'user_id'});

User.hasMany(Outfit,{foreignKey: 'user_id'});
Outfit.belongsTo(User,{foreignKey: 'user_id'});

User.hasMany(Trip,{foreignKey: 'user_id'});
Trip.belongsTo(User,{foreignKey: 'user_id'});

User.hasOne(UserPreferences,{foreignKey: 'user_id'});
UserPreferences.belongsTo(User,{foreignKey: 'user_id'});

User.hasMany(UserInteraction, {foreignKey: 'user_id'});
UserInteraction.belongsTo(User, {foreignKey: 'user_id'});
Clothes.hasMany(UserInteraction, {foreignKey: 'item_id'});
Outfit.hasMany(UserInteraction, {foreignKey: 'outfit_id'});

User.hasMany(OutfitRating, {foreignKey: 'user_id'});
Outfit.hasMany(OutfitRating, {foreignKey: 'outfit_id'});

Clothes.hasOne(ClothesAttributes, {foreignKey: 'clothes_id'});


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
    FashionTrends
};
