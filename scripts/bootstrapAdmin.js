#!/usr/bin/env node
/**
 * SafeLift 360 — Secure Production Super Admin Bootstrap Script
 *
 * Usage:
 *   node scripts/bootstrapAdmin.js
 * Or via env variables:
 *   SUPERADMIN_EMAIL="admin@yourcompany.com" SUPERADMIN_PASSWORD="StrongPasswordHere" node scripts/bootstrapAdmin.js
 *
 * This script never logs passwords or hashes, never overwrites an existing
 * administrator, and preserves existing database state.
 */

require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../config/db');

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return emailRegex.test(email);
}

function ask(rl, question, isMasked = false) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

async function runBootstrap() {
    console.log('==================================================');
    console.log('🛡️  SafeLift 360 — Super Admin Bootstrap Utility');
    console.log('==================================================\n');

    try {
        // 1. Check if a Super Admin already exists
        const [existing] = await db.query(
            "SELECT id, email, role FROM users WHERE role = 'super_admin' LIMIT 1"
        );

        if (existing && existing.length > 0) {
            console.log(`ℹ️  A Super Admin account already exists in this database.`);
            console.log(`ℹ️  Existing account is preserved. No changes made.`);
            await db.end();
            process.exit(0);
        }

        let email = process.env.SUPERADMIN_EMAIL ? process.env.SUPERADMIN_EMAIL.trim().toLowerCase() : null;
        let password = process.env.SUPERADMIN_PASSWORD;

        // If not supplied via env, ask interactively
        if (!email || !password) {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            if (!email) {
                email = (await ask(rl, 'Enter Super Admin Email: ')).toLowerCase();
            }

            if (!password) {
                password = await ask(rl, 'Enter Super Admin Password (min 8 chars): ');
            }

            rl.close();
        }

        // Validate
        if (!email || !isValidEmail(email)) {
            console.error('❌ Error: A valid email address is required.');
            await db.end();
            process.exit(1);
        }

        if (!password || password.length < 8) {
            console.error('❌ Error: Password must be at least 8 characters long.');
            await db.end();
            process.exit(1);
        }

        // Check if email already used by an existing user
        const [userWithEmail] = await db.query(
            'SELECT id FROM users WHERE email = ? LIMIT 1',
            [email]
        );

        if (userWithEmail && userWithEmail.length > 0) {
            console.error(`❌ Error: An account with email '${email}' already exists.`);
            await db.end();
            process.exit(1);
        }

        // Hash and insert
        const passwordHash = await bcrypt.hash(password, 10);
        await db.query(
            `INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
            ['System Administrator', email, passwordHash, 'super_admin']
        );

        console.log(`\n✅ Super Admin account created successfully!`);
        console.log(`📧 Email: ${email}`);
        console.log(`👑 Role: super_admin`);
        console.log('🔒 Password stored securely as bcrypt hash.\n');

        await db.end();
        process.exit(0);
    } catch (err) {
        console.error('❌ Bootstrap Error:', err.message);
        try { await db.end(); } catch (e) {}
        process.exit(1);
    }
}

runBootstrap();
