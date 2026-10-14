const serverless = require('serverless-http');
const { app } = require('../server');
const { initDatabaseSchema } = require('../config/dbInit');

let isInitialized = false;

const handler = serverless(app);

module.exports = async (req, res) => {
    if (!isInitialized) {
        try {
            await initDatabaseSchema();
            isInitialized = true;
            console.log('✅ Database schema initialized (serverless)');
        } catch (err) {
            console.error('❌ DB init error:', err.message);
            // Continue anyway — tables may already exist
            isInitialized = true;
        }
    }
    return handler(req, res);
};

