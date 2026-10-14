require('dotenv').config();

const connectionUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
const isPostgres = Boolean(connectionUrl && (connectionUrl.startsWith('postgres://') || connectionUrl.startsWith('postgresql://')));

if (isPostgres) {
    const { Pool } = require('pg');

    const pool = new Pool({
        connectionString: connectionUrl,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 8000,   // fail fast if DB unreachable
        idleTimeoutMillis: 10000,
        max: 5
    });

    function convertSql(sql) {
        let index = 1;
        // Replace ? with $1, $2... ignoring text inside single quotes
        let converted = sql.replace(/'(?:[^'\\]|\\.)*'|\?/g, (match) => {
            if (match === '?') return `$${index++}`;
            return match;
        });

        // Translate MySQL specific SHOW TABLES
        if (/^\s*SHOW\s+TABLES/i.test(converted)) {
            converted = `SELECT table_name AS "Tables_in_safelift360", table_name AS "Tables_in_db", table_name AS "TABLE_NAME" FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
        }

        // Translate INFORMATION_SCHEMA queries
        if (/INFORMATION_SCHEMA\.TABLES\s+WHERE\s+TABLE_SCHEMA\s*=\s*DATABASE\(\)/i.test(converted)) {
            converted = converted.replace(/INFORMATION_SCHEMA\.TABLES\s+WHERE\s+TABLE_SCHEMA\s*=\s*DATABASE\(\)/i, `information_schema.tables WHERE table_schema = 'public'`);
        }

        if (/INFORMATION_SCHEMA\.COLUMNS\s+WHERE\s+TABLE_SCHEMA\s*=\s*DATABASE\(\)/i.test(converted)) {
            converted = converted.replace(/INFORMATION_SCHEMA\.COLUMNS\s+WHERE\s+TABLE_SCHEMA\s*=\s*DATABASE\(\)/i, `information_schema.columns WHERE table_schema = 'public'`);
        }

        // Return generated ID on INSERT for seamless compatibility with MySQL insertId
        if (/^\s*INSERT\s+INTO\s+/i.test(converted) && !/\bRETURNING\b/i.test(converted)) {
            converted = `${converted} RETURNING id`;
        }

        return converted;
    }

    function wrapRow(row) {
        if (!row || typeof row !== 'object') return row;
        return new Proxy(row, {
            get(target, prop) {
                if (prop in target) return target[prop];
                if (typeof prop === 'string') {
                    const lower = prop.toLowerCase();
                    for (const k of Object.keys(target)) {
                        if (k.toLowerCase() === lower) return target[k];
                    }
                }
                return target[prop];
            }
        });
    }

    const dbWrapper = {
        isPostgres: true,
        pool,
        async query(sql, params = []) {
            const converted = convertSql(sql);
            const res = await pool.query(converted, Array.isArray(params) ? params : [params]);
            const rows = res.rows.map(wrapRow);
            rows.affectedRows = res.rowCount;
            if (res.rows.length > 0 && res.rows[0].id !== undefined) {
                rows.insertId = res.rows[0].id;
            }
            return [rows, res.fields];
        },
        async end() {
            return pool.end();
        }
    };

    module.exports = dbWrapper;
} else {
    const mysql = require('mysql2/promise');

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

    function getPoolConfig() {
        const hasExplicitHost = Boolean(process.env.DB_HOST || process.env.MYSQLHOST);
        const connectionUrl = process.env.MYSQL_URL;

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

    const pool = mysql.createPool(getPoolConfig());
    pool.isPostgres = false;
    module.exports = pool;
}
