const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const http = require('https'); // to be changed to https later
const socketIo = require('socket.io');
const fs = require('fs');
require('dotenv').config();

const logger = require('./utils/logger');
const {sequelize} = require('./database/models');
const routes = require('./routes');
const {errorHandler,notFound} = require('./middlewares/errorHandler');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
});

// Make io globally accessible
global.io = io;
app.set('io', io);

// Security Middlewares
app.use(helmet());

// CORS
app.use(cors({
    origin:process.env.CORS_ORIGIN || '*',
    credentials: true,
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/',limiter);

// Body  Parsing Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' })); 

// Compression Middleware
app.use(compression());

// Logging Middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}   else {
  app.use(morgan('combined', {stream: logger.stream}));
}

// Static Files
app.use('/uploads', express.static('uploads'));

// Create directories
['uploads','logs'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir,{ recursive: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Wardrobe System API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
app.use('/api/v1', routes);

// 404 Handler
app.use('*',notFound);

// Global Error Handler
app.use(errorHandler);

//Database connection and server start
const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
    try {
        //Test the database connection
        await sequelize.authenticate();
        logger.info('Database connection has been established successfully.');
        //Sync the database models
        if (process.env.NODE_ENV !== 'production') {
            await sequelize.sync({ alter: true });
            logger.info('Database synchronized successfully.');
        }
        //Start the server
        server.listen(PORT,HOST,() => {
            logger.info(`Server is running on http://${HOST}:${PORT} in ${process.env.NODE_ENV} mode. /n API Endpoint at http://${HOST}:${PORT}/api/v1`);

             console.log('');
      console.log('Wardrobe System Server Started!');
      console.log(`URL: http://${HOST}:${PORT}`);
      console.log(` API: http://${HOST}:${PORT}/api/v1`);
      console.log(`Health: http://${HOST}:${PORT}/health`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('=================================');
      console.log('');
        })
    } catch (error) {
        logger.error('Unable to start the server:', error);
        process.exit(1);
    }
}

// Shutdown gracefully
const shutdown =async(signal) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    server.close( async() => {
        logger.info('Closed out remaining connections.');
        await sequelize.close();
        logger.info('Database connection closed.');
        process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

//Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    process.exit(1);
});

// Start the server
startServer();

module.exports = {app,io};