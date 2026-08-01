import mysql, { Pool, PoolOptions } from 'mysql2/promise';
import { env } from './env';

const poolConfig: PoolOptions = {
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4',
  timezone: '+00:00',
  // Return DECIMAL/NEWDECIMAL columns as JS numbers instead of strings, so API
  // responses (e.g. employee totalCts, rate ctsMin/ratePerCt, salary totals)
  // are numeric and the frontend can call .toFixed()/arithmetic on them.
  decimalNumbers: true,
};

let pool: Pool;

export function getPool(): Pool {
  if (!pool) {
    pool = mysql.createPool(poolConfig);
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
  }
}

export async function executeQuery<T = any>(
  sql: string,
  params?: any[]
): Promise<T> {
  const [results] = await getPool().execute(sql, params);
  return results as T;
}

export async function executeTransaction<T>(
  callback: (connection: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
