import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { env } from '../config/env';

async function getExecutedSeeds(conn: mysql.Connection): Promise<Set<string>> {
  try {
    const [rows] = await conn.query('SELECT name FROM _seeds');
    return new Set((rows as any[]).map((r) => r.name));
  } catch {
    return new Set();
  }
}

async function run(): Promise<void> {
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.name,
    charset: 'utf8mb4',
    multipleStatements: true,
  });

  try {
    // Start transaction to ensure all seeds run atomically
    await conn.beginTransaction();
    console.log('  Started database transaction');

    // Ensure seed tracker exists before running any seeders
    await conn.query(
      `CREATE TABLE IF NOT EXISTS _seeds (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    // Clear existing seed entries to reset tracking (fixes partial execution issues)
    await conn.query('TRUNCATE TABLE _seeds');
    console.log('  Reset seed tracking table (_seeds)');

    // Clear existing data from tables that exist to avoid duplicates
    console.log('\n  Clearing existing seeded data (if tables exist):');
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    
    // List of tables to clear (only if they exist)
    const tablesToClear = [
      'lots', 'salary_lines', 'salary_periods', 'rate_card_audit_logs', 
      'rate_card', 'employees', 'shapes', 'labour_heads', 'users', '_seeds'
    ];

    for (const table of tablesToClear) {
      try {
        await conn.query(`TRUNCATE TABLE ${table}`);
        console.log(`    Cleared ${table}`);
      } catch (err: any) {
        if (err.code === 'ER_NO_SUCH_TABLE') {
          console.log(`    Skipped ${table} (does not exist yet - run migrations first)`);
        } else {
          throw err;
        }
      }
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('  Finished clearing existing data');

    const seedersDir = path.resolve(__dirname, 'seeders');
    const files = fs.readdirSync(seedersDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    console.log(`\nFound ${files.length} seeders to execute:`);
    const executed = await getExecutedSeeds(conn);

    for (const file of files) {
      if (executed.has(file)) {
        console.log(`  SKIP ${file} (already executed)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(seedersDir, file), 'utf8');
      const statements = sql
        .replace(/^--.*$/gm, '')
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        const upper = stmt.toUpperCase();
        if (upper.startsWith('INSERT') || upper.startsWith('REPLACE') || upper.startsWith('SET') || upper.startsWith('SELECT') || upper.startsWith('CREATE') || upper.startsWith('UPDATE')) {
          await conn.query(stmt);
        }
      }
      
      await conn.query('INSERT INTO _seeds (name) VALUES (?)', [file]);
      console.log(`  OK   ${file}`);
    }

    // Commit transaction if all seeds succeed
    await conn.commit();
    console.log('\n  All seeds committed successfully!');

    console.log('\nAll seeders complete.');
  } catch (err) {
    // Rollback transaction if any error occurs
    await conn.rollback();
    console.error('\n  Transaction rolled back due to error');
    throw err;
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error('\nSeed failed:', err);
  process.exit(1);
});