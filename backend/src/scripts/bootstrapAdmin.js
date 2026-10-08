const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { runMigrations } = require('../db/migrate');
const userService = require('../services/userService');
const config = require('../config');
const logger = require('../utils/logger');

async function main() {
  try {
    await runMigrations();
    
    const adminEmail = (process.env.INITIAL_ADMIN_EMAIL || config.INITIAL_ADMIN_EMAIL || 'admin.ob@gmail.com').toLowerCase().trim();
    const suppliedPassword = process.env.INITIAL_ADMIN_PASSWORD || process.env.ADMIN_BOOTSTRAP_PASSWORD || process.argv[2];
    
    // Check if admin user already exists
    const existing = await userService._query('SELECT id, role, status FROM users WHERE email = $1', [adminEmail]);
    
    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      if (user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
        await userService._query("UPDATE users SET role = 'ADMIN', status = 'ACTIVE', updated_at = NOW() WHERE id = $1", [user.id]);
        console.log(`[Bootstrap] Updated existing user ${adminEmail} to ADMIN and ACTIVE.`);
      } else {
        console.log(`[Bootstrap] Admin user ${adminEmail} already exists with active ADMIN role.`);
      }
      
      if (suppliedPassword) {
        const passCheck = userService.validatePasswordStrength(suppliedPassword);
        if (!passCheck.valid) {
          console.error(`[Bootstrap Error] Invalid password: ${passCheck.error}`);
          process.exit(1);
        }
        const hash = await userService.hashPassword(suppliedPassword);
        await userService._query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, user.id]);
        console.log(`[Bootstrap] Admin password updated successfully.`);
      }
      process.exit(0);
    }
    
    let adminPassword = suppliedPassword;
    let isGenerated = false;
    if (!adminPassword) {
      const crypto = require('crypto');
      adminPassword = 'Admin#' + crypto.randomBytes(6).toString('hex') + '1!';
      isGenerated = true;
    }
    
    const passCheck = userService.validatePasswordStrength(adminPassword);
    if (!passCheck.valid) {
      console.error(`[Bootstrap Error] Password validation failed: ${passCheck.error}`);
      process.exit(1);
    }
    
    const hash = await userService.hashPassword(adminPassword);
    const insertRes = await userService._query(
      `INSERT INTO users (email, password_hash, name, role, status)
       VALUES ($1, $2, 'Platform Administrator', 'ADMIN', 'ACTIVE')
       RETURNING id, email, name, role, status`,
      [adminEmail, hash]
    );
    
    const created = insertRes.rows[0];
    console.log(`[Bootstrap] Successfully created admin account: ${created.email} (ID: ${created.id}, Role: ${created.role}, Status: ${created.status})`);
    if (isGenerated) {
      console.log(`[Bootstrap Notice] A temporary secure password was generated: ${adminPassword}`);
    } else {
      console.log(`[Bootstrap Notice] Admin account initialized with supplied password.`);
    }
    process.exit(0);
  } catch (err) {
    console.error('[Bootstrap Error]', err);
    process.exit(1);
  }
}

main();
