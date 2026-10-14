const bcrypt = require('bcryptjs');
const db = require('./db');

/**
 * Safely checks if a table exists in the current database
 */
async function tableExists(tableName) {
    if (db.isPostgres) {
        const [rows] = await db.query(
            `SELECT table_name FROM information_schema.tables 
             WHERE table_schema = 'public' AND table_name = ?`,
            [tableName]
        );
        return rows && rows.length > 0;
    }
    const [rows] = await db.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
    );
    return rows && rows.length > 0;
}

/**
 * Helper to add missing columns to existing tables safely without modifying existing data
 */
async function addColumnIfNotExists(tableName, columnName, columnDef) {
    if (db.isPostgres) {
        const [cols] = await db.query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
            [tableName, columnName]
        );
        if (!cols || cols.length === 0) {
            await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
            console.log(`✅ Schema compatibility: Added missing column '${columnName}' to '${tableName}'`);
        }
        return;
    }
    const [cols] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    if (!cols || cols.length === 0) {
        await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
        console.log(`✅ Schema compatibility: Added missing column '${columnName}' to '${tableName}'`);
    }
}

/**
 * Initializes and verifies the SafeLift 360 database schema.
 * Operates strictly non-destructively: never drops, truncates, or overwrites existing tables or data.
 */
async function initDatabaseSchema() {
    try {
        console.log(`🔍 Checking database schema and table dependencies (${db.isPostgres ? 'PostgreSQL / Neon' : 'MySQL'})...`);

        if (db.isPostgres) {
            // PostgreSQL DDL
            await db.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    full_name VARCHAR(100) NOT NULL,
                    email VARCHAR(150) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    employee_id VARCHAR(50) DEFAULT NULL,
                    role VARCHAR(30) NOT NULL DEFAULT 'employee',
                    company_id INT DEFAULT NULL,
                    department VARCHAR(100) DEFAULT NULL,
                    must_change_password SMALLINT DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_users_company ON users (company_id);`);

            await addColumnIfNotExists('users', 'company_id', 'INT DEFAULT NULL');
            await addColumnIfNotExists('users', 'department', 'VARCHAR(100) DEFAULT NULL');
            await addColumnIfNotExists('users', 'must_change_password', 'SMALLINT DEFAULT 0');

            await db.query(`
                CREATE TABLE IF NOT EXISTS company_registration_requests (
                    id SERIAL PRIMARY KEY,
                    company_name VARCHAR(255) NOT NULL,
                    contact_person VARCHAR(255) NOT NULL,
                    email VARCHAR(255) NOT NULL UNIQUE,
                    phone VARCHAR(50) DEFAULT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_company_reg_email ON company_registration_requests (email);`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_company_reg_status ON company_registration_requests (status);`);

            await db.query(`
                CREATE TABLE IF NOT EXISTS training_results (
                    id SERIAL PRIMARY KEY,
                    user_id INT NOT NULL,
                    load_inspection_score INT NOT NULL DEFAULT 0,
                    route_check_score INT NOT NULL DEFAULT 0,
                    safe_lift_score INT NOT NULL DEFAULT 0,
                    safety_precautions_score INT NOT NULL DEFAULT 0,
                    total_score INT NOT NULL DEFAULT 0,
                    percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
                    training_duration_seconds INT NOT NULL DEFAULT 0,
                    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status VARCHAR(20) NOT NULL DEFAULT 'completed',
                    CONSTRAINT fk_training_results_user
                        FOREIGN KEY (user_id) REFERENCES users (id)
                        ON DELETE CASCADE
                        ON UPDATE CASCADE
                );
            `);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_training_user_id ON training_results (user_id);`);

            await db.query(`
                CREATE TABLE IF NOT EXISTS certificates (
                    id SERIAL PRIMARY KEY,
                    certificate_uuid VARCHAR(100) NOT NULL UNIQUE,
                    user_id INT NOT NULL,
                    training_result_id INT NOT NULL UNIQUE,
                    certificate_number VARCHAR(100) NOT NULL UNIQUE,
                    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status VARCHAR(20) NOT NULL DEFAULT 'issued',
                    CONSTRAINT fk_certificates_user
                        FOREIGN KEY (user_id) REFERENCES users (id)
                        ON DELETE CASCADE
                        ON UPDATE CASCADE,
                    CONSTRAINT fk_certificates_training_result
                        FOREIGN KEY (training_result_id) REFERENCES training_results (id)
                        ON DELETE CASCADE
                        ON UPDATE CASCADE
                );
            `);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_certificates_user ON certificates (user_id);`);
        } else {
            // MySQL DDL
            const createUsersTableSql = `
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    full_name VARCHAR(100) NOT NULL,
                    email VARCHAR(150) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    employee_id VARCHAR(50) DEFAULT NULL,
                    role VARCHAR(30) NOT NULL DEFAULT 'employee',
                    company_id INT DEFAULT NULL,
                    department VARCHAR(100) DEFAULT NULL,
                    must_change_password TINYINT(1) DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_users_email (email),
                    INDEX idx_users_role (role),
                    INDEX idx_users_company (company_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            `;
            await db.query(createUsersTableSql);

            await addColumnIfNotExists('users', 'company_id', 'INT DEFAULT NULL');
            await addColumnIfNotExists('users', 'department', 'VARCHAR(100) DEFAULT NULL');
            await addColumnIfNotExists('users', 'must_change_password', 'TINYINT(1) DEFAULT 0');

            const createCompanyRequestsTableSql = `
                CREATE TABLE IF NOT EXISTS company_registration_requests (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    company_name VARCHAR(255) NOT NULL,
                    contact_person VARCHAR(255) NOT NULL,
                    email VARCHAR(255) NOT NULL UNIQUE,
                    phone VARCHAR(50) DEFAULT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_company_reg_email (email),
                    INDEX idx_company_reg_status (status)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            `;
            await db.query(createCompanyRequestsTableSql);

            const createTrainingResultsTableSql = `
                CREATE TABLE IF NOT EXISTS training_results (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    load_inspection_score INT NOT NULL DEFAULT 0,
                    route_check_score INT NOT NULL DEFAULT 0,
                    safe_lift_score INT NOT NULL DEFAULT 0,
                    safety_precautions_score INT NOT NULL DEFAULT 0,
                    total_score INT NOT NULL DEFAULT 0,
                    percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
                    training_duration_seconds INT NOT NULL DEFAULT 0,
                    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status VARCHAR(20) NOT NULL DEFAULT 'completed',
                    INDEX idx_training_user_id (user_id),
                    CONSTRAINT fk_training_results_user
                        FOREIGN KEY (user_id) REFERENCES users (id)
                        ON DELETE CASCADE
                        ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            `;
            await db.query(createTrainingResultsTableSql);

            const createCertificatesTableSql = `
                CREATE TABLE IF NOT EXISTS certificates (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    certificate_uuid VARCHAR(100) NOT NULL UNIQUE,
                    user_id INT NOT NULL,
                    training_result_id INT NOT NULL UNIQUE,
                    certificate_number VARCHAR(100) NOT NULL UNIQUE,
                    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status VARCHAR(20) NOT NULL DEFAULT 'issued',
                    INDEX idx_certificates_user (user_id),
                    CONSTRAINT fk_certificates_user
                        FOREIGN KEY (user_id) REFERENCES users (id)
                        ON DELETE CASCADE
                        ON UPDATE CASCADE,
                    CONSTRAINT fk_certificates_training_result
                        FOREIGN KEY (training_result_id) REFERENCES training_results (id)
                        ON DELETE CASCADE
                        ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            `;
            await db.query(createCertificatesTableSql);
        }

        // Super Admin Bootstrap Check (Safeguard 2)
        const [existingSuperAdmins] = await db.query(
            "SELECT id, email FROM users WHERE role = 'super_admin' LIMIT 1"
        );

        if (existingSuperAdmins && existingSuperAdmins.length > 0) {
            console.log(`👑 Existing Super Admin account verified. Preserving existing account credentials.`);
        } else {
            const isProduction = process.env.NODE_ENV === 'production';
            const adminEmail = process.env.SUPERADMIN_EMAIL ? process.env.SUPERADMIN_EMAIL.trim().toLowerCase() : null;
            const adminPassword = process.env.SUPERADMIN_PASSWORD;

            if (isProduction) {
                if (adminEmail && adminPassword && adminPassword.length >= 8) {
                    const superAdminPasswordHash = await bcrypt.hash(adminPassword, 10);
                    await db.query(
                        `INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
                        ['System Administrator', adminEmail, superAdminPasswordHash, 'super_admin']
                    );
                    console.log(`👑 Production Super Admin initialized for: ${adminEmail}`);
                } else {
                    console.log(`ℹ️ [Notice] No Super Admin account exists in this database.`);
                    console.log(`ℹ️ To bootstrap credentials in production, configure SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD in environment variables, or run: npm run bootstrap-admin`);
                }
            } else {
                const devEmail = adminEmail || 'superadmin@safelift360.com';
                const devPassword = adminPassword || 'SuperAdmin123!';
                const superAdminPasswordHash = await bcrypt.hash(devPassword, 10);
                await db.query(
                    `INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
                    ['System Administrator', devEmail, superAdminPasswordHash, 'super_admin']
                );
                console.log(`👑 Development Super Admin account seeded: ${devEmail}`);
            }
        }

        console.log('✅ Database Schema verified: users, company_registration_requests, training_results, certificates ready.');
    } catch (err) {
        console.error('❌ Database Schema Initialization Error:', err);
        throw err;
    }
}

module.exports = { initDatabaseSchema, tableExists };
