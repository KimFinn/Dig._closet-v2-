const multer = require('multer');
const path = require('path');

// Memory storage for direct buffer access (needed for AI tagging)
const storage = multer.memoryStorage();

// File filter
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'), false);
    }
};

// Multer configuration
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB per file
        files: 20 // Max 20 files for batch upload
    },
    fileFilter: fileFilter
});

/**
 * Single file upload middleware
 * Field name: 'image'
 */
const uploadSingle = upload.single('image');

/**
 * Multiple files upload middleware
 * Field name: 'images'
 * Max: 20 files
 */
const uploadMultiple = upload.array('images', 20);

/**
 * Multer error handler middleware
 */
const handleMulterError = (error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File too large. Maximum size is 5MB per file.'
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                message: 'Too many files. Maximum is 20 files per batch.'
            });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                message: 'Unexpected field name. Use "image" for single upload or "images" for batch.'
            });
        }
        return res.status(400).json({
            success: false,
            message: `Upload error: ${error.message}`
        });
    }
    
    if (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
    
    next();
};

module.exports = {
    uploadSingle,
    uploadMultiple,
    handleMulterError
};
