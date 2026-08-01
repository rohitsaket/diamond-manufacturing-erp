import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { env } from '../config/env';

async function ensureDatabase(): Promise<mysql.Connection> {
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    charset: 'utf8mb4',
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${env.db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${env.db.name}\``);
  return conn;
}

async function getExecutedMigrations(conn: mysql.Connection): Promise<Set<string>> {
  try {
    const [rows] = await conn.query('SELECT name FROM _migrations');
    return new Set((rows as any[]).map((r) => r.name));
  } catch {
    return new Set();
  }
}

async function run(): Promise<void> {
  const rollback = process.argv.includes('rollback');
  const conn = await ensureDatabase();

  try {
    const migrationsDir = path.resolve(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (rollback) {
      console.log('Rollback not supported for SQL migrations. Use DROP TABLE manually if needed.');
      return;
    }

    // Ensure migration tracker exists before running any migration
    await conn.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    const executed = await getExecutedMigrations(conn);

    for (const file of files) {
      if (file === '011_create_migration_tracker.sql') continue; // already created above
      if (executed.has(file)) {
        console.log(`  SKIP ${file} (already executed)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      // Remove comment lines, then split by semicolons
      const statements = sql
        .replace(/^--.*$/gm, '')
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        await conn.query(stmt);
      }

      await conn.query('INSERT INTO _migrations (name) VALUES (?)', [file]);
      console.log(`  OK   ${file}`);
    }

    console.log('\nAll migrations complete.');
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
