import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import {
  RefreshCw,
  ShieldCheck,
  Clock,
  AlertTriangle,
  FileWarning,
  HardDrive,
  ChevronRight,
} from 'lucide-react';
import { documentApi } from '../../api/documents';
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategoryCode,
  type DocumentDashboard as DocumentDashboardPayload,
  type DocumentStatus,
} from '../../types/documents';
import {
  PageHeader,
  StatCard,
  TableShell,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  BTN_SECONDARY,
} from '../../components/common/HrmsUI';
import { StatusChip, CategoryIcon, formatBytes, timeAgo } from './documentUi';

const CHART_MARGIN = { top: 8, right: 12, bottom: 4, left: 0 };
const AXIS = { fontSize: 11, fill: 'var(--color-text-muted)' };
const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--color-bg-card)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--color-text-primary)',
};

/** "2026-03" / "2026-03-01" -> "Mar 26". Falls back to the raw label. */
function shortMonth(value: unknown): string {
  const raw = String(value ?? '');
  const match = /^(\d{4})-(\d{2})/.exec(raw);
  if (!match) return raw;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const idx = Number(match[2]) - 1;
  const name = monthNames[idx] ?? match[2];
  return `${name} ${match[1].slice(2)}`;
}

function categoryLabel(code: string): string {
  return DOCUMENT_CATEGORY_LABELS[code as DocumentCategoryCode] ?? code;
}

function Card({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-bg-card border border-border-default rounded-md p-4 ${className}`}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {subtitle && <p className="text-text-muted text-xs mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function DocumentDashboard({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [data, setData] = useState<DocumentDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    documentApi
      .dashboard()
      .then((payload) => setData(payload))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load the document dashboard'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const uploadTrend = useMemo(() => (data?.uploadTrend ?? []).filter((row) => row && row.month), [data]);

  const categoryRows = useMemo(() => {
    const byCategory = data?.byCategory ?? {};
    return Object.entries(byCategory)
      .map(([code, count]) => ({ code, label: categoryLabel(code), count: Number(count ?? 0) }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [data]);

  const statusRows = useMemo(() => {
    const byStatus = data?.byStatus ?? {};
    return Object.entries(byStatus)
      .map(([code, count]) => ({ code, count: Number(count ?? 0) }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [data]);

  const statusMax = statusRows.reduce((max, row) => Math.max(max, row.count), 0);

  const storageRows = useMemo(() => {
    const rows = data?.storage?.byCategory ?? [];
    return [...rows].sort((a, b) => Number(b?.bytes ?? 0) - Number(a?.bytes ?? 0));
  }, [data]);

  const recentUploads = data?.recentUploads ?? [];

  const compliance = data?.complianceScore;
  const complianceIntent: 'success' | 'warning' | 'danger' | 'default' =
    compliance === undefined || compliance === null
      ? 'default'
      : compliance >= 90
        ? 'success'
        : compliance >= 70
          ? 'warning'
          : 'danger';

  const attentionRows: { key: string; label: string; hint: string; count: number; tone: string }[] = data
    ? [
        {
          key: 'verify',
          label: 'Pending verification',
          hint: 'Uploaded documents waiting for an HR check',
          count: data.pendingVerification ?? 0,
          tone: 'text-warning',
        },
        {
          key: 'approve',
          label: 'Pending approval',
          hint: 'Verified documents waiting for sign-off',
          count: data.pendingApproval ?? 0,
          tone: 'text-warning',
        },
        {
          key: 'expiring',
          label: 'Expiring in 30 days',
          hint: 'Renew before the validity lapses',
          count: data.expiringSoon ?? 0,
          tone: 'text-warning',
        },
        {
          key: 'expired',
          label: 'Already expired',
          hint: 'No longer valid — collect a replacement',
          count: data.expired ?? 0,
          tone: 'text-danger',
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Document overview"
        subtitle="Volume, workflow backlog, compliance and storage across the employee document library"
        actions={
          <button onClick={load} disabled={loading} className={`${BTN_SECONDARY} inline-flex items-center gap-2`}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {error && <ErrorBlock message={error} />}

      {loading && !data ? (
        <LoadingBlock label="Loading document dashboard…" />
      ) : !data ? (
        !error && <EmptyBlock message="No dashboard data available" />
      ) : (
        <>
          {/* KPI row -------------------------------------------------------*/}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total documents" value={(data.total ?? 0).toLocaleString('en-IN')} hint="Current versions" />
            <StatCard
              label="Pending verification"
              value={data.pendingVerification ?? 0}
              intent={(data.pendingVerification ?? 0) > 0 ? 'warning' : 'default'}
              hint="Awaiting HR check"
            />
            <StatCard
              label="Pending approval"
              value={data.pendingApproval ?? 0}
              intent={(data.pendingApproval ?? 0) > 0 ? 'warning' : 'default'}
              hint="Awaiting sign-off"
            />
            <StatCard
              label="Expiring in 30 days"
              value={data.expiringSoon ?? 0}
              intent={(data.expiringSoon ?? 0) > 0 ? 'warning' : 'default'}
              hint="Renewal window"
            />
            <StatCard
              label="Expired"
              value={data.expired ?? 0}
              intent={(data.expired ?? 0) > 0 ? 'danger' : 'default'}
              hint="Past validity"
            />
            <StatCard
              label="Missing documents"
              value={data.missingDocuments ?? 0}
              intent={(data.missingDocuments ?? 0) > 0 ? 'danger' : 'default'}
              hint="Required but never uploaded"
            />
            <StatCard
              label="Compliance score"
              value={compliance === undefined || compliance === null ? '—' : `${Math.round(compliance)}%`}
              intent={complianceIntent}
              hint="Required documents present"
            />
            <StatCard
              label="Storage used"
              value={data.storage ? formatBytes(data.storage.totalBytes ?? 0) : '—'}
              hint={data.storage ? `${(data.storage.documentCount ?? 0).toLocaleString('en-IN')} files` : 'No storage data'}
            />
          </div>

          {/* Charts --------------------------------------------------------*/}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Upload trend" subtitle="Documents uploaded per month, last 12 months">
              {uploadTrend.length === 0 ? (
                <EmptyBlock message="No uploads recorded yet" hint="The trend appears once documents are uploaded" />
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <AreaChart data={uploadTrend} margin={CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
                    <XAxis
                      dataKey="month"
                      tick={AXIS}
                      stroke="var(--color-text-muted)"
                      tickFormatter={shortMonth}
                      minTickGap={8}
                    />
                    <YAxis tick={AXIS} stroke="var(--color-text-muted)" allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(label) => shortMonth(label)} />
                    <Area
                      type="monotone"
                      dataKey="count"
                      name="Uploads"
                      stroke="var(--color-primary)"
                      fill="var(--color-primary)"
                      fillOpacity={0.15}
                      strokeWidth={1.8}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Documents by category" subtitle="Current versions grouped by document category">
              {categoryRows.length === 0 ? (
                <EmptyBlock message="No documents categorised yet" />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(230, categoryRows.length * 26)}>
                  <BarChart data={categoryRows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" horizontal={false} />
                    <XAxis type="number" tick={AXIS} stroke="var(--color-text-muted)" allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={AXIS}
                      stroke="var(--color-text-muted)"
                      width={140}
                      interval={0}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-bg-hover)' }} />
                    <Bar dataKey="count" name="Documents" fill="var(--color-primary)" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* By status -------------------------------------------------*/}
            <Card title="Documents by status" subtitle="Where the library sits in the review workflow">
              {statusRows.length === 0 ? (
                <EmptyBlock message="No status breakdown available" />
              ) : (
                <div className="space-y-2.5">
                  {statusRows.map((row) => {
                    const pct = statusMax > 0 ? (row.count / statusMax) * 100 : 0;
                    return (
                      <div key={row.code} className="flex items-center gap-3">
                        <div className="w-40 flex-shrink-0">
                          <StatusChip status={row.code as DocumentStatus} />
                        </div>
                        <div className="flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-14 text-right text-sm tabular-nums text-text-primary">
                          {row.count.toLocaleString('en-IN')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Attention needed ------------------------------------------*/}
            <Card title="Attention needed" subtitle="Open the browser to action these queues">
              {attentionRows.length === 0 ? (
                <EmptyBlock message="Nothing needs attention" />
              ) : (
                <div className="divide-y divide-border-light">
                  {attentionRows.map((row) => {
                    const Icon =
                      row.key === 'verify'
                        ? ShieldCheck
                        : row.key === 'approve'
                          ? FileWarning
                          : row.key === 'expiring'
                            ? Clock
                            : AlertTriangle;
                    return (
                      <button
                        key={row.key}
                        onClick={() => onNavigate('documents')}
                        className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-bg-hover transition-colors rounded-md px-2 -mx-2"
                      >
                        <Icon size={16} className={row.count > 0 ? row.tone : 'text-text-muted'} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-text-primary">{row.label}</p>
                          <p className="text-xs text-text-muted truncate">{row.hint}</p>
                        </div>
                        <span
                          className={`text-lg font-semibold tabular-nums ${row.count > 0 ? row.tone : 'text-text-muted'}`}
                        >
                          {row.count}
                        </span>
                        <ChevronRight size={16} className="text-text-muted flex-shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* Storage ---------------------------------------------------------*/}
          <Card
            title="Storage usage"
            subtitle={
              data.storage
                ? `${formatBytes(data.storage.totalBytes ?? 0)} across ${(data.storage.documentCount ?? 0).toLocaleString('en-IN')} files`
                : 'No storage figures reported'
            }
          >
            {storageRows.length === 0 ? (
              <EmptyBlock message="No per-category storage figures" />
            ) : (
              <TableShell headers={['Category', 'Documents', 'Size']}>
                {storageRows.map((row) => (
                  <tr key={row.category} className="hover:bg-bg-hover transition-colors">
                    <td className="px-3 py-2 text-sm text-text-primary">
                      <span className="inline-flex items-center gap-2">
                        <CategoryIcon category={row.category} size={14} />
                        {categoryLabel(row.category)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">
                      {Number(row.count ?? 0).toLocaleString('en-IN')}
                    </td>
                    <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">
                      {formatBytes(Number(row.bytes ?? 0))}
                    </td>
                  </tr>
                ))}
              </TableShell>
            )}
            {data.storage && (
              <p className="text-text-muted text-[11px] mt-2 inline-flex items-center gap-1.5">
                <HardDrive size={14} /> Figures cover current versions held by the active storage driver.
              </p>
            )}
          </Card>

          {/* Recent uploads --------------------------------------------------*/}
          <Card title="Recently uploaded" subtitle="Latest additions to the library — click a row to browse">
            {recentUploads.length === 0 ? (
              <EmptyBlock message="No recent uploads" />
            ) : (
              <TableShell headers={['Document', 'Employee', 'Type', 'Status', 'Uploaded']}>
                {recentUploads.map((doc) => (
                  <tr
                    key={doc.id}
                    onClick={() => onNavigate('documents')}
                    className="hover:bg-bg-hover transition-colors cursor-pointer"
                  >
                    <td className="px-3 py-2">
                      <p className="text-sm text-text-primary truncate max-w-[260px]">{doc.title || doc.fileName}</p>
                      <p className="text-[11px] text-text-muted truncate max-w-[260px]">{doc.fileName}</p>
                    </td>
                    <td className="px-3 py-2 text-sm text-text-secondary">
                      {doc.employeeName ?? '—'}
                      {doc.empCode && <span className="text-text-muted text-[11px] ml-1.5">{doc.empCode}</span>}
                    </td>
                    <td className="px-3 py-2 text-sm text-text-secondary">{doc.typeName ?? doc.docType ?? '—'}</td>
                    <td className="px-3 py-2">
                      <StatusChip status={doc.status} />
                    </td>
                    <td className="px-3 py-2 text-sm text-text-muted whitespace-nowrap">
                      {doc.uploadedAt ? timeAgo(doc.uploadedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </TableShell>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
