require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./config/db');
const { initDatabaseSchema } = require('./config/dbInit');
const authRoutes = require('./routes/authRoutes');
const trainingRoutes = require('./routes/trainingRoutes');
const adminRoutes = require('./routes/adminRoutes');
const certificateRoutes = require('./routes/certificateRoutes');
const companyRoutes = require('./routes/companyRoutes');
const superAdminRoutes = require('./routes/superAdminRoutes');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Trust Railway reverse proxy (SSL termination) in production
if (isProduction) {
    app.set('trust proxy', 1);
}

// JSON & URL-encoded Body Parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express Session Middleware with production HTTPS cookie support
const sessionSecret = process.env.SESSION_SECRET || 'safelift360_default_session_secret_key';
if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'safelift360_default_session_secret_key')) {
    console.warn('⚠️ [SECURITY WARNING] SESSION_SECRET is unset or using the default key in production. Set a strong random secret in Railway.');
}

app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isProduction, // HTTPS-only in production behind reverse proxy, HTTP in local development
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Favicon handler: Return 204 No Content to avoid 404 log noise
app.get('/favicon.ico', (req, res) => res.status(204).end());

// General Server Health Check API Endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'SafeLift 360 API'
    });
});

// MySQL Database Health Check API Endpoint
app.get('/api/db-health', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT 1 AS result');
        if (rows && rows.length > 0) {
            return res.status(200).json({
                status: 'ok',
                database: 'connected'
            });
        }
        throw new Error('Database query returned empty result.');
    } catch (err) {
        console.error('Database Health Check Error:', err.message);
        return res.status(500).json({
            status: 'error',
            database: 'disconnected',
            message: isProduction ? 'Database connection failure.' : err.message
        });
    }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/super-admin', superAdminRoutes);

// Dedicated route to serve 360° training simulation
app.get('/training', (req, res) => {
    res.sendFile(path.join(__dirname, 'training.html'));
});

// Serve public media/static assets from dedicated directory
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Strict Allowlist for Root Frontend Files (Safeguard 3)
// Prevents exposing server code, config, tests, or dotfiles to clients
const ALLOWED_PUBLIC_FILES = new Map([
    ['/', 'index.html'],
    ['/index.html', 'index.html'],
    ['/login.html', 'login.html'],
    ['/register.html', 'register.html'],
    ['/dashboard.html', 'dashboard.html'],
    ['/admin.html', 'admin.html'],
    ['/super-admin.html', 'super-admin.html'],
    ['/training.html', 'training.html'],
    ['/certificate.html', 'certificate.html'],
    ['/verify.html', 'verify.html'],
    ['/style.css', 'style.css'],
    ['/landing.css', 'landing.css'],
    ['/login.css', 'login.css'],
    ['/script.js', 'script.js'],
    ['/login.js', 'login.js'],
    ['/register.js', 'register.js'],
    ['/dashboard.js', 'dashboard.js'],
    ['/admin.js', 'admin.js'],
    ['/super-admin.js', 'super-admin.js'],
    ['/certificate.js', 'certificate.js'],
    ['/verify.js', 'verify.js']
]);

app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next();
    }
    const targetFile = ALLOWED_PUBLIC_FILES.get(req.path);
    if (targetFile) {
        return res.sendFile(path.join(__dirname, targetFile));
    }
    next();
});

// Fallback 404 Handler for missing resources
app.use((req, res) => {
    res.status(404).send('404 Not Found - SafeLift 360 Resource does not exist.');
});

// Global Error Handler with production sanitization
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: isProduction ? 'An unexpected error occurred.' : err.message
    });
});

// Async Server Startup: Ensures DB initialization completes before accepting traffic
async function startServer() {
    try {
        console.log('🔄 Initializing database schema...');
        await initDatabaseSchema();
        console.log('✅ Database initialization complete.');

        const server = app.listen(PORT, () => {
            console.log(`==================================================`);
            console.log(`🚀 SafeLift 360 Express Server is running!`);
            console.log(`🌐 Server URL: http://localhost:${PORT}`);
            console.log(`🏥 Health Check: http://localhost:${PORT}/api/health`);
            console.log(`🗄️ DB Health Check: http://localhost:${PORT}/api/db-health`);
            console.log(`==================================================`);
        });

        // Graceful shutdown
        const shutdown = (signal) => {
            console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
            server.close(async () => {
                try {
                    await db.end();
                    console.log('📦 Database pool closed.');
                } catch (err) {
                    console.error('Error closing database pool:', err.message);
                }
                process.exit(0);
            });
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        return server;
    } catch (err) {
        console.error('❌ Fatal server startup error:', err);
        process.exit(1);
    }
}

// Start server if run directly
if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };

