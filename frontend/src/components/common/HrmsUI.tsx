import { Loader2, Inbox } from 'lucide-react';

/** Shared input/label classes so HRMS forms stay consistent. */
export const INPUT_CLS =
  'w-full bg-bg-card border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20';
export const LABEL_CLS = 'block text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1';

export const BTN_PRIMARY =
  'px-4 py-2 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
export const BTN_SECONDARY =
  'px-4 py-2 rounded-md border border-border-default text-text-secondary text-sm font-medium hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary">{title}</h2>
        {subtitle && <p className="text-text-secondary text-sm mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  intent = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string | null;
  intent?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const valueTone =
    intent === 'success'
      ? 'text-success'
      : intent === 'warning'
        ? 'text-warning'
        : intent === 'danger'
          ? 'text-danger'
          : intent === 'info'
            ? 'text-primary'
            : 'text-text-primary';

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4">
      <p className="text-text-muted text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${valueTone}`}>{value}</p>
      {hint && <p className="text-text-muted text-[11px] mt-1">{hint}</p>}
    </div>
  );
}

export function Chip({
  label,
  tone = 'default',
  dot = false,
}: {
  label: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';
  dot?: boolean;
}) {
  const tones: Record<string, string> = {
    default: 'bg-bg-hover text-text-secondary border-border-default',
    success: 'bg-success-light text-success border-success/30',
    warning: 'bg-warning-light text-warning border-warning/30',
    danger: 'bg-danger-light text-danger border-danger/30',
    info: 'bg-info-light text-info border-info/30',
    primary: 'bg-primary-light text-primary border-primary/30',
  };
  const dots: Record<string, string> = {
    default: 'bg-text-muted',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    info: 'bg-info',
    primary: 'bg-primary',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${tones[tone]}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dots[tone]}`} />}
      {label}
    </span>
  );
}

export function TableShell({
  headers,
  children,
  footer,
}: {
  headers: string[];
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border-default overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-bg-secondary">
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">{children}</tbody>
          {footer}
        </table>
      </div>
    </div>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-text-muted text-sm">
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}

export function EmptyBlock({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Inbox size={22} className="text-text-muted mb-2" />
      <p className="text-text-secondary text-sm">{message}</p>
      {hint && <p className="text-text-muted text-xs mt-1">{hint}</p>}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="px-4 py-3 rounded-md bg-danger-light border border-danger/30 text-danger text-sm">{message}</div>
  );
}

/** Formats a number as Indian rupees without decimals. */
export function inr(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
