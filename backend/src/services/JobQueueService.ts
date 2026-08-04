import { BaseRepository } from '../repositories/BaseRepository';
import { JobRecord, JobStatus, JobFilters, JobHandler, JobProgressReporter } from '../types/payroll';

class JobRepository extends BaseRepository {
  async insert(jobType: string, payload: unknown, userId: number | null, maxAttempts: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO background_jobs (job_type, payload_json, status, max_attempts, created_by)
       VALUES (?, ?, 'QUEUED', ?, ?)`,
      [jobType, payload === undefined ? null : JSON.stringify(payload), maxAttempts, userId],
    );
    return Number(result.insertId);
  }

  /** The oldest job that is ready to run. */
  async nextQueuedId(): Promise<number | null> {
    const rows = await this.query<any[]>(
      `SELECT id FROM background_jobs
       WHERE status = 'QUEUED' AND (run_after IS NULL OR run_after <= NOW())
       ORDER BY id ASC LIMIT 1`,
    );
    return rows[0] ? Number(rows[0].id) : null;
  }

  /**
   * Atomically take ownership of a job.
   *
   * The status guard in the WHERE clause is the whole mechanism: whichever worker
   * gets `affectedRows === 1` owns the job, everybody else sees 0 and moves on.
   * That is what lets the in-process poller and a Redis worker share one table
   * without ever running the same job twice.
   */
  async claim(jobId: number): Promise<boolean> {
    const result = await this.query<any>(
      `UPDATE background_jobs
       SET status = 'RUNNING', attempts = attempts + 1, started_at = NOW(), progress_pct = 0
       WHERE id = ? AND status = 'QUEUED'`,
      [jobId],
    );
    return Number(result?.affectedRows ?? 0) === 1;
  }

  async findById(jobId: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM background_jobs WHERE id = ?', [jobId]);
    return rows[0] ?? null;
  }

  async updateProgress(jobId: number, pct: number, message?: string): Promise<void> {
    await this.query(
      'UPDATE background_jobs SET progress_pct = ?, progress_message = ? WHERE id = ?',
      [Math.max(0, Math.min(100, Math.round(pct))), message ? message.slice(0, 255) : null, jobId],
    );
  }

  async complete(jobId: number, result: unknown): Promise<void> {
    await this.query(
      `UPDATE background_jobs
       SET status = 'COMPLETED', progress_pct = 100, result_json = ?, finished_at = NOW(), error_message = NULL
       WHERE id = ?`,
      [result === undefined ? null : JSON.stringify(result), jobId],
    );
  }

  async fail(jobId: number, message: string): Promise<void> {
    await this.query(
      `UPDATE background_jobs SET status = 'FAILED', error_message = ?, finished_at = NOW() WHERE id = ?`,
      [message.slice(0, 1000), jobId],
    );
  }

  /** Put a failed attempt back in the queue with a short backoff. */
  async requeue(jobId: number, message: string, delaySeconds: number): Promise<void> {
    await this.query(
      `UPDATE background_jobs
       SET status = 'QUEUED', error_message = ?, run_after = DATE_ADD(NOW(), INTERVAL ? SECOND)
       WHERE id = ?`,
      [message.slice(0, 1000), Math.max(1, Math.floor(delaySeconds)), jobId],
    );
  }

  async cancel(jobId: number): Promise<boolean> {
    const result = await this.query<any>(
      `UPDATE background_jobs SET status = 'CANCELLED', finished_at = NOW()
       WHERE id = ? AND status IN ('QUEUED', 'RUNNING')`,
      [jobId],
    );
    return Number(result?.affectedRows ?? 0) === 1;
  }

  async list(filters: JobFilters): Promise<any[]> {
    let sql = 'SELECT * FROM background_jobs WHERE 1 = 1';
    const params: any[] = [];
    if (filters.jobType) {
      sql += ' AND job_type = ?';
      params.push(filters.jobType);
    }
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    const limit = Math.min(200, Math.max(1, Math.floor(Number(filters.limit) || 50)));
    sql += ` ORDER BY id DESC LIMIT ${limit}`;
    return this.query<any[]>(sql, params);
  }
}

const toIso = (value: unknown): string | null => (value ? new Date(value as string).toISOString() : null);

const parseJson = (value: unknown): any => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
};

/**
 * Database-backed background job queue.
 *
 * `background_jobs` is always the source of truth. An in-process poller claims
 * work every couple of seconds, which means the server needs nothing but MySQL
 * to run payroll in the background. When `REDIS_URL` is configured a BullMQ
 * worker is started *in addition*, claiming the very same rows through the same
 * atomic UPDATE, so the two modes can coexist and Redis going away never stops
 * jobs from running.
 */
export class JobQueueService {
  private repo = new JobRepository();
  private handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  /** Single-flight guard: one tick may never overlap the next. */
  private ticking = false;
  private started = false;
  private redisQueue: any = null;
  private redisWorker: any = null;
  private redisAnnounced = false;

  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  hasHandler(jobType: string): boolean {
    return this.handlers.has(jobType);
  }

  /** Queue a job and return its id. The row exists before this resolves. */
  async enqueue(jobType: string, payload: unknown, userId: number | null, maxAttempts = 3): Promise<number> {
    const jobId = await this.repo.insert(jobType, payload, userId, maxAttempts);
    if (this.redisQueue) {
      try {
        await this.redisQueue.add(jobType, { jobId }, { removeOnComplete: true, removeOnFail: true });
      } catch {
        // The DB poller will pick it up regardless; Redis is only an accelerator.
      }
    }
    return jobId;
  }

  start(pollIntervalMs = 2000): void {
    if (this.started) return;
    this.started = true;
    this.setupRedis();
    this.timer = setInterval(() => {
      void this.tick();
    }, Math.max(500, pollIntervalMs));
    // Never hold the process open just to poll.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.redisWorker) {
      try {
        void this.redisWorker.close();
      } catch {
        /* ignore */
      }
      this.redisWorker = null;
    }
    if (this.redisQueue) {
      try {
        void this.redisQueue.close();
      } catch {
        /* ignore */
      }
      this.redisQueue = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const jobId = await this.repo.nextQueuedId();
      if (jobId === null) return;
      await this.runJob(jobId);
    } catch (error) {
      console.error('[jobs] poll failed:', (error as Error).message);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Claim and execute one job. Safe to call from several workers at once: only
   * the claimer proceeds.
   */
  async runJob(jobId: number): Promise<void> {
    const claimed = await this.repo.claim(jobId);
    if (!claimed) return;

    const row = await this.repo.findById(jobId);
    if (!row) return;

    const handler = this.handlers.get(row.job_type);
    if (!handler) {
      await this.repo.fail(jobId, `No handler registered for job type ${row.job_type}`);
      return;
    }

    const updateProgress: JobProgressReporter = async (pct, message) => {
      await this.repo.updateProgress(jobId, pct, message);
    };

    try {
      const result = await handler(parseJson(row.payload_json), updateProgress);
      await this.repo.complete(jobId, result ?? null);
    } catch (error) {
      const message = (error as Error).message || 'Job failed';
      const attempts = Number(row.attempts ?? 0) + 1;
      const maxAttempts = Number(row.max_attempts ?? 3);
      if (attempts < maxAttempts) {
        // Linear backoff: attempt 1 waits 5s, attempt 2 waits 10s, …
        await this.repo.requeue(jobId, message, 5 * attempts);
      } else {
        await this.repo.fail(jobId, message);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async getJob(jobId: number): Promise<JobRecord | null> {
    const row = await this.repo.findById(jobId);
    return row ? this.toRecord(row) : null;
  }

  async listJobs(filters: JobFilters = {}): Promise<JobRecord[]> {
    const rows = await this.repo.list(filters);
    return rows.map((r) => this.toRecord(r));
  }

  async cancelJob(jobId: number): Promise<boolean> {
    return this.repo.cancel(jobId);
  }

  private toRecord(r: any): JobRecord {
    return {
      id: Number(r.id),
      jobType: r.job_type,
      payload: parseJson(r.payload_json),
      status: r.status as JobStatus,
      progressPct: Number(r.progress_pct ?? 0),
      progressMessage: r.progress_message ?? null,
      result: parseJson(r.result_json),
      errorMessage: r.error_message ?? null,
      attempts: Number(r.attempts ?? 0),
      maxAttempts: Number(r.max_attempts ?? 3),
      runAfter: toIso(r.run_after),
      startedAt: toIso(r.started_at),
      finishedAt: toIso(r.finished_at),
      createdBy: r.created_by === null || r.created_by === undefined ? null : Number(r.created_by),
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Optional Redis / BullMQ acceleration
  // -------------------------------------------------------------------------

  /**
   * Wire up BullMQ when REDIS_URL is configured.
   *
   * Everything here is best-effort: a missing package, a bad URL or a dead Redis
   * must never stop the server booting or stop jobs running, because the DB
   * poller already handles every job on its own.
   */
  private setupRedis(): void {
    const url = process.env.REDIS_URL;
    if (!url) return;

    try {
      // Required lazily so the server boots fine when bullmq is absent.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const bullmq = require('bullmq');
      const connection = { url, maxRetriesPerRequest: null as number | null };

      this.redisQueue = new bullmq.Queue('payroll-jobs', { connection });
      this.redisWorker = new bullmq.Worker(
        'payroll-jobs',
        async (job: any) => {
          const jobId = Number(job?.data?.jobId);
          if (Number.isFinite(jobId) && jobId > 0) await this.runJob(jobId);
        },
        { connection, concurrency: 1 },
      );

      this.redisWorker.on('error', (error: Error) => {
        if (!this.redisAnnounced) {
          this.redisAnnounced = true;
          console.warn('[jobs] Redis worker error, continuing on the in-process poller:', error.message);
        }
      });

      console.log('[jobs] Redis/BullMQ worker attached; the DB poller remains the source of truth');
    } catch (error) {
      this.redisQueue = null;
      this.redisWorker = null;
      console.warn(
        '[jobs] Redis unavailable, using the in-process poller only:',
        (error as Error).message,
      );
    }
  }
}

/** Process-wide queue. Call `start()` once from the server bootstrap. */
export const jobQueueService = new JobQueueService();
