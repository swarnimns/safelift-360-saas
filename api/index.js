const serverless = require('serverless-http');
const { app } = require('../server');
const { initDatabaseSchema } = require('../config/dbInit');

let isInitialized = false;

const handler = serverless(app);

// Wraps a promise with a timeout to prevent indefinite hangs in serverless
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        )
    ]);
}

module.exports = async (req, res) => {
    // Fast-path: skip DB init for favicon to avoid unnecessary delays
    if (req.url === '/favicon.ico' || req.url === '/favicon.png') {
        res.statusCode = 204;
        res.end();
        return;
    }

    if (!isInitialized) {
        try {
            await withTimeout(initDatabaseSchema(), 10000, 'DB init');
            isInitialized = true;
            console.log('✅ Database schema initialized (serverless)');
        } catch (err) {
            console.error('❌ DB init error:', err.message);
            // Continue anyway — tables may already exist or DB vars not set
            isInitialized = true;
        }
    }
    return handler(req, res);
};


