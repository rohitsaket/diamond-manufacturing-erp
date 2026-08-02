import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { toDateString } from './dateUtils';

/**
 * Pure helpers for the document module: hashing, mime policy, filename
 * sanitising, tag handling and request fingerprinting. Nothing here touches the
 * database or the filesystem beyond streaming a file for its hash.
 */

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * SHA-256 of a file, streamed. A 40 MB scan of a passport should never sit in
 * the heap just to be hashed, so this never reads the whole file into memory.
 */
export function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function sha256OfBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** SHA-256 of a UTF-8 string — used to store share tokens without storing the token. */
export function sha256OfString(value: string): string {
  return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

/** Hash whatever a driver can give us: a local path streams, anything else buffers. */
export async function sha256OfSource(source: { path?: string | null; buffer?: Buffer | null }): Promise<string> {
  if (source.path) return sha256OfFile(source.path);
  if (source.buffer) return sha256OfBuffer(source.buffer);
  throw new Error('Nothing to hash: no file path or buffer was provided');
}

// ---------------------------------------------------------------------------
// Mime / extension policy
// ---------------------------------------------------------------------------

/**
 * The document module's mime policy: everything an HR department realistically
 * files against an employee.
 *
 * NOTE: `src/middleware/upload.ts` currently runs a narrower multer
 * `fileFilter` (JPEG, PNG, WebP, PDF only) and this module does not modify it.
 * Until that filter is relaxed, multer rejects the wider set before the service
 * ever sees it — this map is the policy that applies the moment it is relaxed.
 * `MULTER_MIME_TYPES` below documents what actually gets through today.
 */
export const ALLOWED_MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
});

/** Alias kept explicit so callers can name the wider policy at the call site. */
export const EXTENDED_MIME_TYPES = ALLOWED_MIME_TYPES;

/** What the current multer fileFilter actually admits. Informational only. */
export const MULTER_MIME_TYPES: readonly string[] = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export function isAllowedMime(mime: string | undefined | null): boolean {
  if (!mime) return false;
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TYPES, String(mime).toLowerCase().trim());
}

export function extensionForMime(mime: string | undefined | null): string | null {
  if (!mime) return null;
  return ALLOWED_MIME_TYPES[String(mime).toLowerCase().trim()] ?? null;
}

/** Human list used in error messages. */
export function allowedExtensionList(): string {
  return Array.from(new Set(Object.values(ALLOWED_MIME_TYPES))).join(', ');
}

// ---------------------------------------------------------------------------
// Names, sizes and tags
// ---------------------------------------------------------------------------

/** Strip directories and anything that could escape a path or confuse a shell. */
export function sanitizeFileName(name: string): string {
  const base = path.basename(String(name ?? '').replace(/\\/g, '/'));
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+/, '')
    .slice(-120);
  return cleaned || 'file';
}

/** Build a collision-resistant storage key for a fresh upload. */
export function buildStorageKey(employeeId: number, originalName: string): string {
  const stamp = Date.now();
  const salt = crypto.randomBytes(4).toString('hex');
  return `emp${employeeId}_${stamp}_${salt}_${sanitizeFileName(originalName)}`;
}

export function formatBytes(bytes: number): string {
  const value = Number(bytes ?? 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const MAX_TAGS = 25;
const MAX_TAG_LENGTH = 40;

/** Comma-separated tag string -> trimmed, de-duplicated, bounded list. */
export function parseTags(csv: string | null | undefined): string[] {
  if (!csv) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(csv).split(',')) {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Inverse of parseTags, clamped to the `tags VARCHAR(500)` column. */
export function formatTags(tags: string[] | null | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  const joined = parseTags(tags.join(',')).join(',');
  if (!joined) return null;
  return joined.length > 500 ? joined.slice(0, 500).replace(/,[^,]*$/, '') : joined;
}

// ---------------------------------------------------------------------------
// Request fingerprinting (audit trail)
// ---------------------------------------------------------------------------

export interface RequestLike {
  headers?: Record<string, string | string[] | undefined> | undefined;
  socket?: { remoteAddress?: string | undefined } | null | undefined;
  ip?: string | undefined;
}

/**
 * Tiny user-agent heuristic. Deliberately dependency-free: the audit trail only
 * needs "which kind of thing was this", not a parsed UA database.
 */
export function detectDeviceAndBrowser(userAgent?: string | null): { device: string; browser: string } {
  const ua = String(userAgent ?? '');
  if (!ua.trim()) return { device: 'Unknown', browser: 'Unknown' };

  let device = 'Desktop';
  if (/\biPad\b|Tablet|PlayBook|Silk/i.test(ua)) device = 'Tablet';
  else if (/Mobi|Android|iPhone|iPod|Windows Phone|BlackBerry/i.test(ua)) device = 'Mobile';
  else if (/curl|wget|python-requests|node-fetch|axios|PostmanRuntime|Go-http-client|okhttp/i.test(ua)) device = 'API client';
  else if (/bot|crawler|spider/i.test(ua)) device = 'Bot';

  let os = '';
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  // Order matters: Edge and Opera both claim Chrome, Chrome claims Safari.
  let browser = 'Unknown';
  if (/Edg[eA]?\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  else if (/curl\//i.test(ua)) browser = 'curl';
  else if (/PostmanRuntime/i.test(ua)) browser = 'Postman';
  else if (/python-requests|node-fetch|axios|Go-http-client|okhttp|wget/i.test(ua)) browser = 'HTTP client';

  return {
    device: (os ? `${device} (${os})` : device).slice(0, 80),
    browser: browser.slice(0, 80),
  };
}

/** Client IP, honouring a proxy header before falling back to the socket. */
export function clientIp(req?: RequestLike | null): string | null {
  if (!req) return null;

  const forwarded = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) {
    const first = String(raw).split(',')[0]?.trim();
    if (first) return normaliseIp(first);
  }

  const real = req.headers?.['x-real-ip'];
  const realRaw = Array.isArray(real) ? real[0] : real;
  if (realRaw) return normaliseIp(String(realRaw).trim());

  const socketIp = req.socket?.remoteAddress ?? req.ip;
  return socketIp ? normaliseIp(socketIp) : null;
}

function normaliseIp(value: string): string {
  // ::ffff:127.0.0.1 is just 127.0.0.1 wearing an IPv6 coat.
  const stripped = value.startsWith('::ffff:') ? value.slice(7) : value;
  return stripped.slice(0, 45);
}

export function userAgentOf(req?: RequestLike | null): string | null {
  const ua = req?.headers?.['user-agent'];
  const value = Array.isArray(ua) ? ua[0] : ua;
  return value ? String(value).slice(0, 400) : null;
}

// ---------------------------------------------------------------------------
// Country normalisation
// ---------------------------------------------------------------------------

/**
 * `document_types.country` / `document_requirements.country` are ISO-2, but
 * `employees.country` is a free-text VARCHAR(100) that in practice holds names
 * such as "India". Requirement matching has to bridge the two, both in JS and
 * inside the set-based compliance SQL, so both use this one table.
 */
const COUNTRY_ISO2: Readonly<Record<string, string>> = Object.freeze({
  INDIA: 'IN',
  BHARAT: 'IN',
  'UNITED STATES': 'US',
  'UNITED STATES OF AMERICA': 'US',
  USA: 'US',
  AMERICA: 'US',
  'UNITED KINGDOM': 'GB',
  UK: 'GB',
  ENGLAND: 'GB',
  'GREAT BRITAIN': 'GB',
  'UNITED ARAB EMIRATES': 'AE',
  UAE: 'AE',
  CANADA: 'CA',
  AUSTRALIA: 'AU',
  'NEW ZEALAND': 'NZ',
  GERMANY: 'DE',
  FRANCE: 'FR',
  ITALY: 'IT',
  SPAIN: 'ES',
  PORTUGAL: 'PT',
  NETHERLANDS: 'NL',
  BELGIUM: 'BE',
  SWITZERLAND: 'CH',
  AUSTRIA: 'AT',
  IRELAND: 'IE',
  SWEDEN: 'SE',
  NORWAY: 'NO',
  DENMARK: 'DK',
  FINLAND: 'FI',
  POLAND: 'PL',
  CZECHIA: 'CZ',
  'CZECH REPUBLIC': 'CZ',
  HUNGARY: 'HU',
  ROMANIA: 'RO',
  GREECE: 'GR',
  TURKEY: 'TR',
  RUSSIA: 'RU',
  UKRAINE: 'UA',
  ARMENIA: 'AM',
  GEORGIA: 'GE',
  ISRAEL: 'IL',
  'SAUDI ARABIA': 'SA',
  QATAR: 'QA',
  OMAN: 'OM',
  KUWAIT: 'KW',
  BAHRAIN: 'BH',
  EGYPT: 'EG',
  KENYA: 'KE',
  NIGERIA: 'NG',
  GHANA: 'GH',
  BOTSWANA: 'BW',
  NAMIBIA: 'NA',
  'SOUTH AFRICA': 'ZA',
  CHINA: 'CN',
  'HONG KONG': 'HK',
  TAIWAN: 'TW',
  JAPAN: 'JP',
  'SOUTH KOREA': 'KR',
  KOREA: 'KR',
  SINGAPORE: 'SG',
  MALAYSIA: 'MY',
  INDONESIA: 'ID',
  THAILAND: 'TH',
  VIETNAM: 'VN',
  PHILIPPINES: 'PH',
  'SRI LANKA': 'LK',
  NEPAL: 'NP',
  BANGLADESH: 'BD',
  PAKISTAN: 'PK',
  MYANMAR: 'MM',
  BRAZIL: 'BR',
  MEXICO: 'MX',
  ARGENTINA: 'AR',
  CHILE: 'CL',
  COLOMBIA: 'CO',
});

/** Free-text country -> ISO-2, or null when it cannot be resolved confidently. */
export function normalizeCountry(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.length === 2) return raw.toUpperCase();
  return COUNTRY_ISO2[raw.toUpperCase()] ?? null;
}

/**
 * The same mapping as a MySQL expression, so per-employee compliance can be
 * computed with one GROUP BY instead of a loop over the workforce. The keys are
 * module constants (never user input), so string interpolation here is safe.
 */
export function countryIso2SqlExpr(column: string): string {
  const whens = Object.entries(COUNTRY_ISO2)
    .map(([name, iso]) => `WHEN '${name}' THEN '${iso}'`)
    .join(' ');
  return `(CASE UPPER(TRIM(${column})) ${whens} ELSE (CASE WHEN CHAR_LENGTH(TRIM(${column})) = 2 THEN UPPER(TRIM(${column})) ELSE NULL END) END)`;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Calendar-correct month arithmetic on a `YYYY-MM-DD` string, in UTC. */
export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return toDateString(d);
}

/** Clamp anything a query string can hand us into a safe positive integer. */
export function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
