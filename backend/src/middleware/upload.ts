import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Request } from 'express';
import { env } from '../config/env';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

function ensureUploadDir(): string {
  if (!fs.existsSync(env.uploadDir)) fs.mkdirSync(env.uploadDir, { recursive: true });
  return env.uploadDir;
}

/** Strip anything that could escape the upload directory or confuse a shell. */
function sanitiseName(original: string): string {
  return path
    .basename(original)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-80);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      cb(null, ensureUploadDir());
    } catch (err: any) {
      cb(err, '');
    }
  },
  filename: (req: Request, file, cb) => {
    const employeeId = req.params.id ?? 'x';
    const stamp = Date.now();
    cb(null, `emp${employeeId}_${stamp}_${sanitiseName(file.originalname)}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('Only JPG, PNG, WebP and PDF files are allowed'));
      return;
    }
    cb(null, true);
  },
});

/** Absolute path for a stored file, guarded against traversal outside the upload dir. */
export function resolveStoredFile(fileName: string): string | null {
  const base = path.resolve(env.uploadDir);
  const full = path.resolve(base, path.basename(fileName));
  if (!full.startsWith(base)) return null;
  return fs.existsSync(full) ? full : null;
}
