// Shared presentation helpers for the Documents page family.
// Kept deliberately small: status/expiry chips, category iconography, a few
// formatters, and the authenticated blob fetch every preview/download needs.
import {
  IdCard,
  User,
  GraduationCap,
  Award,
  Briefcase,
  History,
  Wallet,
  HeartPulse,
  Plane,
  ShieldCheck,
  PenTool,
  FileText,
  Package,
  Scale,
  Upload,
  File,
} from 'lucide-react';
import { Chip } from '../../components/common/HrmsUI';
import { DOCUMENT_STATUS_META } from '../../types/documents';
import type { DocumentCategoryCode, DocumentStatus } from '../../types/documents';
import { BASE_URL, tokenStore } from '../../api/client';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const errMsg = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

// ---------------------------------------------------------------------------
// Formatters (date-fns is not installed — these are the local equivalents)
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `1.4 MB`. Uses binary units, which is what the storage layer reports. */
export function formatBytes(n: number | null | undefined): string {
  const bytes = Number(n ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : value >= 100 ? 0 : 1)} ${units[i]}`;
}

/** `02 Aug 2026`. Accepts both `YYYY-MM-DD` and full ISO timestamps. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) {
    const month = MONTHS[Number(m[2]) - 1] ?? m[2];
    return `${m[3]} ${month} ${m[1]}`;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

/** `02 Aug 2026, 14:05` in the viewer's locale. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatDate(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${d.getFullYear()}, ${hh}:${mm}`;
}

/** Whole days from today until `iso` — negative once it is in the past. */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  let target: number;
  if (m) {
    target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    target = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

/** `4 hours ago` / `in 3 days`. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  const future = seconds < 0;
  const abs = Math.abs(seconds);
  if (abs < 45) return future ? 'in a moment' : 'just now';

  let value: number;
  let unit: string;
  if (abs < 3600) {
    value = Math.max(1, Math.round(abs / 60));
    unit = 'minute';
  } else if (abs < 86_400) {
    value = Math.round(abs / 3600);
    unit = 'hour';
  } else if (abs < 604_800) {
    value = Math.round(abs / 86_400);
    unit = 'day';
  } else if (abs < 2_592_000) {
    value = Math.round(abs / 604_800);
    unit = 'week';
  } else if (abs < 31_536_000) {
    value = Math.round(abs / 2_592_000);
    unit = 'month';
  } else {
    value = Math.round(abs / 31_536_000);
    unit = 'year';
  }
  const plural = value === 1 ? '' : 's';
  return future ? `in ${value} ${unit}${plural}` : `${value} ${unit}${plural} ago`;
}

// ---------------------------------------------------------------------------
// Chips and icons
// ---------------------------------------------------------------------------

export function StatusChip({ status }: { status: DocumentStatus }) {
  const meta = DOCUMENT_STATUS_META[status];
  if (!meta) return <Chip label={String(status)} tone="default" />;
  return <Chip label={meta.label} tone={meta.tone} dot />;
}

type IconComponent = React.ComponentType<{ size?: number | string; className?: string }>;

const CATEGORY_ICONS: Record<DocumentCategoryCode, IconComponent> = {
  GOVERNMENT_ID: IdCard,
  PERSONAL: User,
  EDUCATION: GraduationCap,
  CERTIFICATION: Award,
  EMPLOYMENT: Briefcase,
  EXPERIENCE: History,
  PAYROLL_FINANCE: Wallet,
  MEDICAL: HeartPulse,
  IMMIGRATION: Plane,
  COMPLIANCE: ShieldCheck,
  SIGNATURE: PenTool,
  HR_FORM: FileText,
  ASSET: Package,
  LEGAL: Scale,
  EMPLOYEE_GENERATED: Upload,
  OTHER: File,
};

export function CategoryIcon({
  category,
  size = 16,
  className = 'text-text-muted',
}: {
  category: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const Icon = CATEGORY_ICONS[(category ?? 'OTHER') as DocumentCategoryCode] ?? File;
  return <Icon size={size} className={className} />;
}

export function TagPills({ tags, max = 4 }: { tags: string[] | null | undefined; max?: number }) {
  const list = (tags ?? []).filter((t) => t && t.trim() !== '');
  if (list.length === 0) return null;
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {shown.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center px-1.5 py-0.5 rounded bg-bg-secondary border border-border-light text-text-secondary text-[10px]"
        >
          {tag}
        </span>
      ))}
      {rest > 0 && <span className="text-text-muted text-[10px]">+{rest}</span>}
    </span>
  );
}

export function ExpiryChip({ expiresOn }: { expiresOn: string | null | undefined }) {
  if (!expiresOn) return null;
  const days = daysUntil(expiresOn);
  if (days === null) return null;
  if (days < 0) return <Chip label="Expired" tone="danger" dot />;
  if (days <= 30) return <Chip label={`Expires in ${days} day${days === 1 ? '' : 's'}`} tone="warning" dot />;
  return <span className="text-xs text-text-secondary whitespace-nowrap">{formatDate(expiresOn)}</span>;
}

// ---------------------------------------------------------------------------
// Authenticated file access
// ---------------------------------------------------------------------------

/**
 * Document download/print endpoints require the bearer token, so a plain
 * `<a href>` returns 401. Fetch with the header and hand back a blob URL.
 *
 * Callers MUST `URL.revokeObjectURL` the result — a leaked blob URL pins the
 * whole file in memory for the lifetime of the tab.
 */
export async function fetchBlobUrl(pathOrUrl: string): Promise<string> {
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${tokenStore.get() ?? ''}` } });
  } catch {
    throw new Error('Cannot reach the server. Is the backend running?');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Could not open the file (${res.status})`);
  }
  return URL.createObjectURL(await res.blob());
}

/** Fetch with the token, then push the blob at the browser as a download. */
export async function downloadViaBlob(pathOrUrl: string, fileName: string): Promise<void> {
  const url = await fetchBlobUrl(pathOrUrl);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser a tick to start the download before releasing the blob.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** What the preview pane can render inline. */
export function previewKind(mimeType: string | null | undefined): 'image' | 'pdf' | 'other' {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}
