/**
 * SafeLift 360 — Non-Destructive Deployment Verification Suite
 *
 * This test suite verifies:
 * 1. Server startup & database initialization
 * 2. Health & DB-Health endpoints
 * 3. Static allowlist serving (HTML, CSS, JS, assets)
 * 4. Sensitive file blocking (strict protection against source leaks)
 * 5. Database read-only integrity (zero inserts, updates, or deletes)
 */

const http = require('http');
const db = require('./config/db');
const { app } = require('./server');

const TEST_PORT = 3899;

function fetchUrl(path) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: TEST_PORT,
            path: path,
            method: 'GET'
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                resolve({ status: res.statusCode, headers: res.headers, body });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function runTests() {
    console.log('==================================================');
    console.log('🧪 SAFELIFT 360 NON-DESTRUCTIVE VERIFICATION SUITE');
    console.log('==================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(condition, name, detail = '') {
        if (condition) {
            console.log(`✅ PASS: ${name}`);
            passed++;
        } else {
            console.error(`❌ FAIL: ${name} ${detail ? `(${detail})` : ''}`);
            failed++;
        }
    }

    let server;
    try {
        // Start ephemeral test server
        server = await new Promise((resolve, reject) => {
            const s = app.listen(TEST_PORT, '127.0.0.1', () => resolve(s));
            s.on('error', reject);
        });

        // 1. Health check
        const health = await fetchUrl('/api/health');
        assert(health.status === 200, 'GET /api/health returns 200 OK');
        const healthData = JSON.parse(health.body);
        assert(healthData.status === 'ok', 'GET /api/health body indicates status "ok"');

        // 2. DB health check
        const dbHealth = await fetchUrl('/api/db-health');
        assert(dbHealth.status === 200, 'GET /api/db-health returns 200 OK');
        const dbHealthData = JSON.parse(dbHealth.body);
        assert(dbHealthData.database === 'connected', 'GET /api/db-health confirms database is connected');

        // 3. Allowed frontend static assets
        const root = await fetchUrl('/');
        assert(root.status === 200 && root.body.includes('SafeLift 360'), 'GET / successfully serves index.html');

        const login = await fetchUrl('/login.html');
        assert(login.status === 200, 'GET /login.html returns 200 OK');

        const style = await fetchUrl('/style.css');
        assert(style.status === 200, 'GET /style.css returns 200 OK');

        const script = await fetchUrl('/script.js');
        assert(script.status === 200, 'GET /script.js returns 200 OK');

        const asset = await fetchUrl('/assets/warehouse.jpg');
        assert(asset.status === 200, 'GET /assets/warehouse.jpg returns 200 OK');

        const favicon = await fetchUrl('/favicon.ico');
        assert(favicon.status === 204, 'GET /favicon.ico returns 204 No Content');

        // 4. Strict Allowlist Security: Verify blocked sensitive files
        const envTest = await fetchUrl('/.env');
        assert(envTest.status === 404, 'GET /.env is strictly blocked (returns 404)');

        const serverTest = await fetchUrl('/server.js');
        assert(serverTest.status === 404, 'GET /server.js is strictly blocked (returns 404)');

        const packageTest = await fetchUrl('/package.json');
        assert(packageTest.status === 404, 'GET /package.json is strictly blocked (returns 404)');

        const dbConfigTest = await fetchUrl('/config/db.js');
        assert(dbConfigTest.status === 404, 'GET /config/db.js is strictly blocked (returns 404)');

        const controllerTest = await fetchUrl('/controllers/authController.js');
        assert(controllerTest.status === 404, 'GET /controllers/authController.js is strictly blocked (returns 404)');

        const sqlTest = await fetchUrl('/config/schema.sql');
        assert(sqlTest.status === 404, 'GET /config/schema.sql is strictly blocked (returns 404)');

        // 5. Database Read-Only Integrity Check
        const [tables] = await db.query('SHOW TABLES');
        assert(tables.length === 4, 'Database retains all 4 expected tables');

        const [superAdminRows] = await db.query("SELECT id, email, role FROM users WHERE role = 'super_admin'");
        assert(superAdminRows.length >= 1, 'Super Admin account is intact and preserved');

    } catch (err) {
        console.error('Fatal test error:', err);
        failed++;
    } finally {
        if (server) {
            server.close();
        }
        await db.end();
    }

    console.log('\n==================================================');
    console.log(`📊 TEST RESULTS: ${passed} Passed, ${failed} Failed`);
    console.log('==================================================');

    process.exit(failed > 0 ? 1 : 0);
}

runTests();
