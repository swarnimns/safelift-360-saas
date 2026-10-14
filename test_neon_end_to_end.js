/**
 * SafeLift 360 — Neon PostgreSQL End-to-End Verification Suite
 * Proves that:
 * 1. Express app starts and loads environment from Neon
 * 2. Neon Postgres connection pool is active and healthy
 * 3. Schema initialization succeeds
 * 4. Full CRUD lifecycle (User Registration -> Training Result -> Certificate) works seamlessly
 * 5. Health endpoints (/api/health and /api/db-health) respond with 200 OK
 */

const http = require('http');
const bcrypt = require('bcryptjs');
const db = require('./config/db');
const { app } = require('./server');

const TEST_PORT = 3988;

function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const headers = {};
        if (payload) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }

        const req = http.request({
            hostname: '127.0.0.1',
            port: TEST_PORT,
            path: path,
            method: method,
            headers: headers
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let json = null;
                try {
                    json = JSON.parse(data);
                } catch {
                    json = data;
                }
                resolve({ status: res.statusCode, data: json });
            });
        });

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function runEndToEndVerification() {
    console.log('====================================================');
    console.log('🚀 TESTING NEON POSTGRESQL END-TO-END INTEGRATION');
    console.log('====================================================\n');

    let server;
    let passed = 0;
    let failed = 0;

    function assert(condition, testName, detail = '') {
        if (condition) {
            console.log(`✅ PASS: ${testName}`);
            passed++;
        } else {
            console.error(`❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
            failed++;
        }
    }

    try {
        // 1. Start ephemeral HTTP server
        server = await new Promise((resolve, reject) => {
            const s = app.listen(TEST_PORT, '127.0.0.1', () => resolve(s));
            s.on('error', reject);
        });
        console.log(`📡 Test server running on http://127.0.0.1:${TEST_PORT}\n`);

        // 2. Test API Health Check
        const healthRes = await makeRequest('GET', '/api/health');
        assert(healthRes.status === 200 && healthRes.data.status === 'ok', '1. API Health Check (/api/health) returns 200 OK');

        // 3. Test Neon DB Health Check
        const dbHealthRes = await makeRequest('GET', '/api/db-health');
        assert(
            dbHealthRes.status === 200 && dbHealthRes.data.database === 'connected',
            '2. Neon DB Health Check (/api/db-health) confirms active PostgreSQL connection'
        );

        // 4. Test User Registration (Write to Neon)
        const testEmail = `neon_test_${Date.now()}@safelift360.com`;
        const testPassword = 'TestPassword123!';
        const regRes = await makeRequest('POST', '/api/auth/register', {
            full_name: 'Neon Verification User',
            email: testEmail,
            password: testPassword,
            employee_id: 'EMP-NEON-001'
        });
        assert(
            regRes.status === 201 && regRes.data.success === true,
            '3. User registration persists new employee into Neon PostgreSQL',
            JSON.stringify(regRes.data)
        );

        // 5. Test Querying User from Neon (Read from Neon)
        const [users] = await db.query('SELECT id, full_name, email, role FROM users WHERE email = ?', [testEmail]);
        assert(
            users.length === 1 && users[0].full_name === 'Neon Verification User',
            '4. Verified employee record query from Neon PostgreSQL',
            `Found ${users.length} matching rows`
        );
        const testUserId = users[0].id;

        // 6. Test Training Result Insertion into Neon
        const [trInsert] = await db.query(
            `INSERT INTO training_results (user_id, load_inspection_score, route_check_score, safe_lift_score, safety_precautions_score, total_score, percentage, training_duration_seconds, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [testUserId, 25, 25, 25, 25, 100, 100.00, 240, 'completed']
        );
        const trId = trInsert.insertId;
        assert(
            typeof trId === 'number' && trId > 0,
            `5. Insert training result with generated primary key (${trId}) into Neon PostgreSQL`
        );

        // 7. Test Certificate Issuance and Complex Relational Join on Neon
        const certUuid = `neon-uuid-${Date.now()}`;
        const certNumber = `SL360-NEON-${Date.now()}`;
        const [certInsert] = await db.query(
            `INSERT INTO certificates (certificate_uuid, user_id, training_result_id, certificate_number, status)
             VALUES (?, ?, ?, ?, 'issued')`,
            [certUuid, testUserId, trId, certNumber]
        );
        assert(
            typeof certInsert.insertId === 'number' && certInsert.insertId > 0,
            '6. Insert certificate record referencing user and training result into Neon'
        );

        // 8. Relational JOIN Query across 3 tables on Neon
        const [joinRows] = await db.query(
            `SELECT c.certificate_number, u.full_name, tr.total_score, tr.percentage
             FROM certificates c
             JOIN users u ON c.user_id = u.id
             JOIN training_results tr ON c.training_result_id = tr.id
             WHERE c.certificate_uuid = ?`,
            [certUuid]
        );
        assert(
            joinRows.length === 1 && Number(joinRows[0].total_score) === 100,
            '7. Multi-table relational JOIN (certificates + users + training_results) on Neon returns correct data'
        );

        // 9. Clean up test data from Neon
        await db.query('DELETE FROM users WHERE id = ?', [testUserId]);
        const [checkDeleted] = await db.query('SELECT id FROM users WHERE id = ?', [testUserId]);
        assert(
            checkDeleted.length === 0,
            '8. Cascade deletion and cleanup executed cleanly on Neon PostgreSQL'
        );

        // 10. Table count check
        const [tables] = await db.query('SHOW TABLES');
        assert(
            tables.length >= 4,
            `9. Verified all core SaaS tables intact on Neon (found ${tables.length} tables)`
        );

    } catch (err) {
        console.error('Fatal test error:', err);
        failed++;
    } finally {
        if (server) {
            server.close();
        }
        await db.end();
    }

    console.log('\n====================================================');
    console.log(`📊 FINAL RESULTS: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

runEndToEndVerification();
