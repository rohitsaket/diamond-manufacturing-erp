import fs from 'fs';
import path from 'path';
import { env } from '../../config/env';

/**
 * Storage abstraction for document bytes.
 *
 * The only driver that actually moves bytes today is `local`, which writes into
 * `env.uploadDir` — the same directory multer already writes to, so a file that
 * arrives through the upload middleware is already "in" this driver and only
 * needs its key (the multer `filename`) recorded.
 *
 * Cloud drivers are deliberately NOT implemented. `listStorageDrivers()`
 * advertises them as unavailable and `getStorageDriver('s3')` throws, because a
 * driver that silently pretends to store bytes it never stored is worse than no
 * driver at all. This interface is the extension point: implement it, register
 * the instance in `DRIVERS`, and the rest of the document module needs no change.
 */
export interface StoredObject {
  key: string;
  size: number;
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Buffer): Promise<StoredObject>;
  putFromPath(key: string, sourcePath: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  /** Streaming read used by download/print/share endpoints. */
  stream(key: string): NodeJS.ReadableStream;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /** Absolute on-disk path when the driver is local, otherwise null. */
  absolutePathIfLocal(key: string): string | null;
}

export interface StorageDriverInfo {
  name: string;
  available: boolean;
  reason?: string;
}

/** Filesystem driver rooted at a single base directory. */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly baseDir: string;

  constructor(baseDir: string = env.uploadDir) {
    this.baseDir = path.resolve(baseDir);
  }

  /** Resolve a key inside the base dir, refusing anything that escapes it. */
  private resolveKey(key: string): string {
    const cleaned = String(key ?? '').trim().replace(/\\/g, '/');
    if (!cleaned) throw new Error('A storage key is required');
    if (path.isAbsolute(cleaned)) throw new Error('A storage key must be relative to the storage root');

    const full = path.resolve(this.baseDir, cleaned);
    const relative = path.relative(this.baseDir, full);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('That storage key resolves outside the storage root');
    }
    return full;
  }

  private ensureDirFor(fullPath: string): void {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  async put(key: string, data: Buffer): Promise<StoredObject> {
    const full = this.resolveKey(key);
    this.ensureDirFor(full);
    await fs.promises.writeFile(full, data);
    return { key, size: data.length };
  }

  async putFromPath(key: string, sourcePath: string): Promise<StoredObject> {
    const full = this.resolveKey(key);
    const source = path.resolve(sourcePath);
    if (!fs.existsSync(source)) throw new Error('The uploaded file is missing from disk');

    if (source !== full) {
      this.ensureDirFor(full);
      await fs.promises.copyFile(source, full);
    }
    const stat = await fs.promises.stat(full);
    return { key, size: stat.size };
  }

  async get(key: string): Promise<Buffer> {
    return fs.promises.readFile(this.resolveKey(key));
  }

  stream(key: string): NodeJS.ReadableStream {
    return fs.createReadStream(this.resolveKey(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(this.resolveKey(key));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await fs.promises.unlink(this.resolveKey(key));
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }

  absolutePathIfLocal(key: string): string | null {
    try {
      return this.resolveKey(key);
    } catch {
      return null;
    }
  }
}

const localDriver = new LocalStorageDriver();

/** Every driver the module knows about; only `local` carries an implementation. */
const DRIVERS: Array<StorageDriverInfo & { instance?: StorageDriver }> = [
  { name: 'local', available: true, instance: localDriver },
  { name: 's3', available: false, reason: 'No AWS credentials configured' },
  { name: 'azure', available: false, reason: 'No Azure Blob Storage connection string configured' },
  { name: 'gcs', available: false, reason: 'No Google Cloud service account configured' },
  { name: 'minio', available: false, reason: 'No MinIO endpoint or credentials configured' },
];

/**
 * Resolve a driver by name. Unavailable drivers throw rather than silently
 * falling back to local, so a misconfigured deployment fails loudly instead of
 * scattering files where nobody expects them.
 */
export function getStorageDriver(name?: string): StorageDriver {
  const requested = String(name ?? 'local').trim().toLowerCase() || 'local';
  const entry = DRIVERS.find((d) => d.name === requested);
  if (!entry) throw new Error(`Unknown storage driver "${requested}"`);
  if (!entry.instance) throw new Error(`Storage driver "${requested}" is not configured`);
  return entry.instance;
}

export function listStorageDrivers(): StorageDriverInfo[] {
  return DRIVERS.map((d) =>
    d.reason ? { name: d.name, available: d.available, reason: d.reason } : { name: d.name, available: d.available },
  );
}

export function defaultStorageDriverName(): string {
  return localDriver.name;
}
