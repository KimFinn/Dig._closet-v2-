const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
// Phase 0 fix: this was `require('https')` aliased to the name `http`,
// so `http.createServer(app)` below actually built a TLS server with no
// cert/key configured anywhere. The process still booted and still
// bound the port, but every plain HTTP request got back an empty reply
// — confirmed by an actual request against a live boot, not just static
// analysis. Per PRD §6.2, TLS terminates at the load balancer, not in
// the Node app, so this should be plain HTTP unconditionally, not a
// placeholder for "add TLS later".
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
require('dotenv').config();

const logger = require('./utils/logger');
const {sequelize} = require('./database/models');
const routes = require('./routes');
const {errorHandler,notFound} = require('./middleware/errorHandler');
const { tripModeManager } = require('./services/tripModeManager.service');
const { scheduleNightlyLearning } = require('./queues/preferenceLearningQueue');
const { scheduleDailyCheckIn } = require('./queues/checkInQueue');

// ============================================================================
// CORS ORIGIN ALLOWLIST
// ============================================================================
// Phase 0 fix: this used to be `origin: process.env.CORS_ORIGIN || '*'`
// with `credentials: true` — spec-invalid (a browser rejects
// Access-Control-Allow-Origin: * combined with credentialed requests
// anyway) and, worse, meant CORS was wide open by default any time
// CORS_ORIGIN wasn't set. CORS_ORIGIN is now a required, explicit,
// comma-separated allowlist (e.g. "https://app.example.com,https://admin.example.com").
// In production a missing/empty value fails fast at boot instead of
// silently defaulting to "allow everyone" — in development it falls
// back to the standard localhost dev-server ports so `npm run dev`
// keeps working with zero extra config.
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

if (allowedOrigins.length === 0) {
    if (isProduction) {
        logger.error('CORS_ORIGIN is not set — refusing to boot in production with an open CORS policy.');
        process.exit(1);
    }
    allowedOrigins.push('http://localhost:3000', 'http://localhost:5173');
    logger.warn(`CORS_ORIGIN not set — defaulting to development origins: ${allowedOrigins.join(', ')}`);
}

const corsOptionsDelegate = (origin, callback) => {
    // No Origin header (server-to-server, curl, mobile apps) — allow.
    if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
    }
    logger.warn('Blocked CORS request from disallowed origin', { origin });
    const err = new Error('Not allowed by CORS');
    err.statusCode = 403;
    return callback(err);
};

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Make io globally accessible
global.io = io;
app.set('io', io);

// Security Middlewares
app.use(helmet());

// CORS
app.use(cors({
    origin: corsOptionsDelegate,
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
// Needed to read the httpOnly refresh-token cookie (see utils/tokens.js)
app.use(cookieParser());

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
        // Schema is now owned by the migrations in
        // src/database/migrations/ (run with `npm run db:migrate`, or
        // `npm run seed` to migrate + seed in one step) — see
        // database/models/index.js. This used to also call
        // `sequelize.sync({ alter: true })` here in development, which
        // had Sequelize infer and apply schema changes straight from the
        // model definitions on every boot. Running that *alongside* real
        // migrations is how schemas drift out from under their own
        // migration history — alter can "fix" a table in a way the
        // committed migrations don't know about, so the next `npm run
        // db:migrate` on a teammate's machine (or in CI/production,
        // where sync never ran) produces a different schema. Migrations
        // are the single source of truth now, in every environment.
        // Phase 2 fix (found while building the Phase 2 learning loop,
        // not part of it): tripModeManager.start() -- the daily cron
        // that auto-activates/deactivates trips -- was never actually
        // called anywhere. It only appeared inside a comment block at
        // the bottom of tripModeManager.service.js labeled "usage
        // example"; the cron job itself has never run. Starting it here
        // for real.
        tripModeManager.start();

        // Phase 2: register the nightly preference-learning job and the
        // daily check-in email job. Both are repeatable Bull jobs (see
        // src/queues/preferenceLearningQueue.js and
        // src/queues/checkInQueue.js); Bull dedups repeatable jobs by
        // their cron pattern + jobId, so calling these on every boot is
        // safe and does not create duplicate schedules. The actual work
        // runs in the worker process (npm run worker), not here -- this
        // only registers when it should run.
        await scheduleNightlyLearning();
        await scheduleDailyCheckIn();

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
        tripModeManager.stop();
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