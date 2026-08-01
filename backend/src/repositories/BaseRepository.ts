import { executeQuery, executeTransaction, getPool } from '../config/database';

export class BaseRepository {
  protected async query<T = any>(sql: string, params?: any[]): Promise<T> {
    return executeQuery<T>(sql, params);
  }

  protected async transaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return executeTransaction(fn);
  }

  protected async getConnection() {
    const pool = getPool();
    return pool.getConnection();
  }
}
