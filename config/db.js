const mysql = require('mysql2/promise');
require('dotenv').config();

// Helper to safely parse a connection URL into explicit mysql2 options
function parseConnectionUrl(urlString) {
    if (!urlString || typeof urlString !== 'string') return null;
    try {
        const parsed = new URL(urlString);
        return {
            host: decodeURIComponent(parsed.hostname),
            port: parsed.port ? Number(parsed.port) : 3306,
            user: decodeURIComponent(parsed.username || ''),
            password: decodeURIComponent(parsed.password || ''),
            database: decodeURIComponent(parsed.pathname ? parsed.pathname.replace(/^\//, '') : '')
        };
    } catch {
        return null;
    }
}

// Determine connection settings supporting both local XAMPP and Railway MySQL
function getPoolConfig() {
    const hasExplicitHost = Boolean(process.env.DB_HOST || process.env.MYSQLHOST);
    const connectionUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;

    // 1. If explicit host variables are available (DB_HOST or Railway's MYSQLHOST),
    // prioritize individual variables to prevent URL-encoding issues with complex passwords.
    if (hasExplicitHost) {
        const host = process.env.DB_HOST || process.env.MYSQLHOST;
        const port = Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306);
        const user = process.env.DB_USER || process.env.MYSQLUSER || 'root';
        const password = process.env.DB_PASSWORD !== undefined
            ? process.env.DB_PASSWORD
            : (process.env.MYSQLPASSWORD !== undefined ? process.env.MYSQLPASSWORD : '');
        const database = process.env.DB_NAME || process.env.MYSQLDATABASE || 'safelift360';

        const config = {
            host,
            port,
            user,
            password,
            database,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 10000
        };

        if (process.env.DB_SSL === 'true' || process.env.MYSQL_SSL === 'true') {
            config.ssl = { rejectUnauthorized: false };
        }

        return config;
    }

    // 2. If no individual host is defined, fall back to connection URL if provided
    if (connectionUrl) {
        const parsed = parseConnectionUrl(connectionUrl);
        if (parsed && parsed.host) {
            const config = {
                host: parsed.host,
                port: parsed.port,
                user: parsed.user,
                password: parsed.password,
                database: parsed.database || 'safelift360',
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0,
                enableKeepAlive: true,
                keepAliveInitialDelay: 10000
            };

            if (process.env.DB_SSL === 'true' || process.env.MYSQL_SSL === 'true') {
                config.ssl = { rejectUnauthorized: false };
            }

            return config;
        }
    }

    // 3. Default fallback for local development when no environment variables are set
    const defaultConfig = {
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: '',
        database: 'safelift360',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000
    };

    if (process.env.DB_SSL === 'true' || process.env.MYSQL_SSL === 'true') {
        defaultConfig.ssl = { rejectUnauthorized: false };
    }

    return defaultConfig;
}

// Create MySQL Connection Pool
const pool = mysql.createPool(getPoolConfig());

module.exports = pool;


