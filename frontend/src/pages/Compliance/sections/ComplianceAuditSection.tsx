import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertOctagon, ClipboardCheck, Cpu, ListChecks, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { complianceApi } from '../../../api/compliance';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
  StatCard,
  TableShell,
  inr,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { TabBar } from '../../../components/common/TabBar';

// ---------------------------------------------------------------------------
// Local helpers (date-fns is not installed)
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const iso = String(value).slice(0, 10);
  const parts = iso.split('-');
  if (parts.length !== 3) return String(value);
  const [y, m, d] = parts;
  const monthIndex = Number(m) - 1;
  if (!y || !d) return String(value);
  return `${d} ${MONTH_NAMES[monthIndex] ?? m} ${y}`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const SEVERITY_TONE: Record<string, Tone> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'default',
};

const FINDING_STATUS_TONE: Record<string, Tone> = {
  OPEN: 'danger',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
  ACCEPTED_RISK: 'info',
  CLOSED: 'default',
};

const AUDIT_STATUS_TONE: Record<string, Tone> = {
  PLANNED: 'default',
  IN_PROGRESS: 'info',
  FINDINGS_ISSUED: 'warning',
  CLOSED: 'success',
  CANCELLED: 'default',
};

const RATING_TONE: Record<string, Tone> = {
  COMPLIANT: 'success',
  MINOR_ISSUES: 'warning',
  MAJOR_ISSUES: 'danger',
  NON_COMPLIANT: 'danger',
};

const ACTION_STATUS_TONE: Record<string, Tone> = {
  PENDING: 'warning',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  CANCELLED: 'default',
};

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const FINDING_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'ACCEPTED_RISK', 'CLOSED'];
const AUDIT_TYPES = ['INTERNAL', 'EXTERNAL', 'STATUTORY', 'INSPECTION'];
const ACTION_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const OPEN_ACTION_STATUSES = new Set(['PENDING', 'IN_PROGRESS']);

interface Finding {
  id: number;
  auditId?: number | null;
  auditTitle?: string | null;
  findingNo?: string | null;
  category?: string | null;
  severity?: string | null;
  title?: string | null;
  description?: string | null;
  affectedCount?: number | null;
  financialImpact?: number | null;
  ruleCode?: string | null;
  isAutomated?: boolean;
  status?: string | null;
  identifiedOn?: string | null;
  dueDate?: string | null;
  ownerUserId?: number | null;
  ownerName?: string | null;
  actionCount?: number | null;
  openActionCount?: number | null;
}

interface Action {
  id: number;
  findingId: number;
  actionText?: string | null;
  actionType?: string | null;
  ownerUserId?: number | null;
  ownerName?: string | null;
  dueDate?: string | null;
  status?: string | null;
  completedOn?: string | null;
  remarks?: string | null;
}

interface Audit {
  id: number;
  title?: string | null;
  auditType?: string | null;
  scope?: string | null;
  financialYear?: string | null;
  auditorName?: string | null;
  authority?: string | null;
  plannedOn?: string | null;
  startedOn?: string | null;
  completedOn?: string | null;
  status?: string | null;
  overallRating?: string | null;
  summary?: string | null;
  findingCount?: number | null;
  openFindingCount?: number | null;
  createdAt?: string | null;
}

/**
 * Audits, the findings they raise, and the corrective actions that close them.
 *
 * The backend refuses to close a finding with outstanding actions, and refuses
 * to close an audit with open findings. Those refusals are surfaced verbatim —
 * a paraphrase would hide which record is actually blocking.
 */
export function ComplianceAuditSection() {
  const [tab, setTab] = useState<'findings' | 'audits' | 'actions'>('findings');

  const [findings, setFindings] = useState<Finding[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [openActions, setOpenActions] = useState<(Action & { findingTitle?: string | null; severity?: string | null })[]>([]);

  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const [detail, setDetail] = useState<Finding | null>(null);
  const [creatingAudit, setCreatingAudit] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      complianceApi.findings({}),
      complianceApi.audits({}).catch(() => []),
      complianceApi.findingsSummary().catch(() => null),
    ])
      .then(([findingRows, auditRows, summaryRes]) => {
        const list = Array.isArray(findingRows) ? (findingRows as Finding[]) : [];
        setFindings(list);
        setAudits(Array.isArray(auditRows) ? (auditRows as Audit[]) : []);
        setSummary(summaryRes ?? null);

        // There is no cross-finding action endpoint, so the flat list is built
        // from the findings that report outstanding actions.
        const withOpen = list.filter((f) => Number(f.openActionCount ?? 0) > 0);
        return Promise.all(
          withOpen.map((f) =>
            complianceApi
              .findingActions(f.id)
              .then((rows) =>
                (Array.isArray(rows) ? (rows as Action[]) : [])
                  .filter((a) => OPEN_ACTION_STATUSES.has(String(a.status ?? '')))
                  .map((a) => ({ ...a, findingTitle: f.title, severity: f.severity })),
              )
              .catch(() => []),
          ),
        );
      })
      .then((groups) => setOpenActions(groups.flat()))
      .catch((err: any) => setError(err?.message ?? 'Could not load audits and findings'))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const f of findings) if (f.category) set.add(String(f.category));
    return [...set].sort();
  }, [findings]);

  const filteredFindings = useMemo(
    () =>
      findings.filter(
        (f) =>
          (severityFilter === 'ALL' || f.severity === severityFilter) &&
          (statusFilter === 'ALL' || f.status === statusFilter) &&
          (categoryFilter === 'ALL' || f.category === categoryFilter),
      ),
    [findings, severityFilter, statusFilter, categoryFilter],
  );

  const criticalOpen = useMemo(
    () => findings.filter((f) => f.severity === 'CRITICAL' && f.status !== 'CLOSED').length,
    [findings],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TabBar
          tabs={[
            { id: 'findings', label: 'Findings', count: findings.length },
            { id: 'audits', label: 'Audits', count: audits.length },
            { id: 'actions', label: 'Corrective actions', count: openActions.length },
          ]}
          active={tab}
          onChange={(id) => setTab(id === 'audits' ? 'audits' : id === 'actions' ? 'actions' : 'findings')}
        />
        <div className="flex items-center gap-2">
          {tab === 'audits' && (
            <button onClick={() => setCreatingAudit(true)} className={BTN_PRIMARY}>
              <Plus size={14} className="inline mr-1.5" />
              New audit
            </button>
          )}
          <button onClick={load} className={BTN_SECONDARY} disabled={loading}>
            <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {loading && firstLoad && <LoadingBlock label="Loading findings…" />}

      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button onClick={load} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      )}

      {/* Findings ---------------------------------------------------------- */}
      {!error && tab === 'findings' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Open findings"
              value={Number(summary?.open ?? 0)}
              intent={Number(summary?.open ?? 0) > 0 ? 'danger' : 'success'}
            />
            <StatCard label="Critical (not closed)" value={criticalOpen} intent={criticalOpen > 0 ? 'danger' : 'default'} />
            <StatCard
              label="Overdue actions"
              value={Number(summary?.overdueActions ?? 0)}
              intent={Number(summary?.overdueActions ?? 0) > 0 ? 'warning' : 'default'}
            />
            <StatCard label="Total findings" value={Number(summary?.total ?? findings.length)} />
          </div>

          <FilterRow label="Severity" options={SEVERITIES} value={severityFilter} onChange={setSeverityFilter} />
          <FilterRow label="Status" options={FINDING_STATUSES} value={statusFilter} onChange={setStatusFilter} />
          <FilterRow label="Category" options={categories} value={categoryFilter} onChange={setCategoryFilter} />

          {!firstLoad && filteredFindings.length === 0 ? (
            <EmptyBlock
              message="No findings for these filters"
              hint="Findings appear here once the compliance checks raise them, or when one is entered by hand."
            />
          ) : (
            <TableShell
              headers={[
                'Finding',
                'Title',
                'Category',
                'Severity',
                'Affected',
                'Financial impact',
                'Status',
                'Owner',
                'Due',
                'Source',
              ]}
            >
              {filteredFindings.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => setDetail(f)}
                  className="hover:bg-bg-hover transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2 text-xs font-mono text-text-secondary whitespace-nowrap">
                    {f.findingNo ?? `#${f.id}`}
                  </td>
                  <td className="px-3 py-2 text-sm text-text-primary">{f.title ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {f.category ? <Chip label={String(f.category).replace(/_/g, ' ')} tone="primary" /> : '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {f.severity ? (
                      <Chip label={String(f.severity)} tone={SEVERITY_TONE[String(f.severity)] ?? 'default'} />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 text-sm text-right font-mono whitespace-nowrap ${
                      Number(f.affectedCount ?? 0) > 0 ? 'text-danger' : 'text-text-muted'
                    }`}
                  >
                    {Number(f.affectedCount ?? 0)}
                  </td>
                  <td className="px-3 py-2 text-sm text-right font-mono text-text-secondary whitespace-nowrap">
                    {f.financialImpact === null || f.financialImpact === undefined ? '—' : inr(Number(f.financialImpact))}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {f.status ? (
                      <Chip label={String(f.status).replace(/_/g, ' ')} tone={FINDING_STATUS_TONE[String(f.status)] ?? 'default'} dot />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                    {f.ownerName ?? (f.ownerUserId ? `user #${f.ownerUserId}` : '—')}
                  </td>
                  <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">{fmtDate(f.dueDate)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {f.isAutomated ? (
                      <span className="inline-flex items-center gap-1">
                        <Chip label="Auto" tone="info" />
                        {f.ruleCode && <span className="text-text-muted text-[10px] font-mono">{f.ruleCode}</span>}
                      </span>
                    ) : (
                      <span className="text-text-muted text-xs">Manual</span>
                    )}
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* Audits ------------------------------------------------------------ */}
      {!error && tab === 'audits' && (
        <div className="space-y-3">
          {!firstLoad && audits.length === 0 ? (
            <EmptyBlock message="No audits recorded" hint="Create one to group findings under a single inspection." />
          ) : (
            <div className="space-y-2">
              {audits.map((a) => (
                <AuditRow key={a.id} audit={a} onChanged={load} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Corrective actions ------------------------------------------------ */}
      {!error && tab === 'actions' && (
        <div className="space-y-3">
          <p className="text-text-muted text-xs">
            Every outstanding corrective action across all findings. A finding cannot be closed while any of its
            actions is still pending or in progress.
          </p>
          {!firstLoad && openActions.length === 0 ? (
            <EmptyBlock message="No open corrective actions" />
          ) : (
            <TableShell headers={['Action', 'Finding', 'Type', 'Owner', 'Due', 'Status', '']}>
              {openActions.map((a) => {
                const overdue = !!a.dueDate && String(a.dueDate).slice(0, 10) < todayISO();
                return (
                  <tr key={a.id} className={`transition-colors ${overdue ? 'bg-danger-light' : 'hover:bg-bg-hover'}`}>
                    <td className="px-3 py-2 text-sm text-text-primary">{a.actionText ?? '—'}</td>
                    <td className="px-3 py-2 text-sm text-text-secondary">
                      {a.findingTitle ?? `#${a.findingId}`}
                      {a.severity && (
                        <span className="ml-1.5">
                          <Chip label={String(a.severity)} tone={SEVERITY_TONE[String(a.severity)] ?? 'default'} />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{a.actionType ?? '—'}</td>
                    <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                      {a.ownerName ?? (a.ownerUserId ? `user #${a.ownerUserId}` : '—')}
                    </td>
                    <td
                      className={`px-3 py-2 text-sm whitespace-nowrap ${overdue ? 'text-danger font-medium' : 'text-text-secondary'}`}
                    >
                      {fmtDate(a.dueDate)}
                      {overdue && ' · overdue'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Chip label={String(a.status ?? '—')} tone={ACTION_STATUS_TONE[String(a.status)] ?? 'default'} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <ActionStatusPicker action={a} onChanged={load} />
                    </td>
                  </tr>
                );
              })}
            </TableShell>
          )}
        </div>
      )}

      <AnimatePresence>
        {detail && <FindingDetailModal finding={detail} onClose={() => setDetail(null)} onChanged={load} />}
        {creatingAudit && <CreateAuditModal onClose={() => setCreatingAudit(false)} onCreated={load} />}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter pills
// ---------------------------------------------------------------------------

function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-text-muted text-[10px] uppercase tracking-wider font-semibold mr-1">{label}</span>
      {['ALL', ...options].map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
            value === o
              ? 'bg-primary-light border-primary/30 text-primary'
              : 'border-border-default text-text-muted hover:border-text-muted'
          }`}
        >
          {o === 'ALL' ? 'All' : o.replace(/_/g, ' ')}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit row
// ---------------------------------------------------------------------------

function AuditRow({ audit, onChanged }: { audit: Audit; onChanged: () => void }) {
  const [closing, setClosing] = useState(false);

  const close = () => {
    setClosing(true);
    complianceApi
      .closeAudit(audit.id)
      .then(() => onChanged())
      .catch((err: any) => window.alert(err?.message ?? 'The audit could not be closed'))
      .finally(() => setClosing(false));
  };

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <ShieldCheck size={15} className="text-text-muted" />
            <span className="text-text-primary text-sm font-medium">{audit.title ?? '—'}</span>
            {audit.auditType && <Chip label={String(audit.auditType)} tone="primary" />}
            {audit.status && (
              <Chip label={String(audit.status).replace(/_/g, ' ')} tone={AUDIT_STATUS_TONE[String(audit.status)] ?? 'default'} dot />
            )}
            {audit.overallRating && (
              <Chip label={String(audit.overallRating).replace(/_/g, ' ')} tone={RATING_TONE[String(audit.overallRating)] ?? 'default'} />
            )}
          </div>
          <p className="text-text-secondary text-xs">{audit.scope ?? 'No scope recorded'}</p>
          <div className="flex items-center gap-3 flex-wrap text-[11px] text-text-muted">
            <span>Auditor: {audit.auditorName ?? '—'}</span>
            <span>· Authority: {audit.authority ?? '—'}</span>
            <span>· FY {audit.financialYear ?? '—'}</span>
            <span>· Planned {fmtDate(audit.plannedOn)}</span>
            <span>· Started {fmtDate(audit.startedOn)}</span>
            <span>· Completed {fmtDate(audit.completedOn)}</span>
            <span>· Created {timeAgo(audit.createdAt)}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-text-secondary">{Number(audit.findingCount ?? 0)} finding(s)</span>
            <span
              className={Number(audit.openFindingCount ?? 0) > 0 ? 'text-danger font-medium' : 'text-text-muted'}
            >
              {Number(audit.openFindingCount ?? 0)} still open
            </span>
          </div>
          {audit.summary && <p className="text-text-secondary text-xs">{audit.summary}</p>}
        </div>

        <button onClick={close} className={BTN_SECONDARY} disabled={closing || audit.status === 'CLOSED'}>
          <ClipboardCheck size={14} className="inline mr-1.5" />
          {audit.status === 'CLOSED' ? 'Closed' : closing ? 'Closing…' : 'Close audit'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create audit
// ---------------------------------------------------------------------------

function CreateAuditModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [auditType, setAuditType] = useState('INTERNAL');
  const [scope, setScope] = useState('');
  const [financialYear, setFinancialYear] = useState('');
  const [auditorName, setAuditorName] = useState('');
  const [authority, setAuthority] = useState('');
  const [plannedOn, setPlannedOn] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  const submit = () => {
    setSaving(true);
    complianceApi
      .createAudit({
        title: title.trim(),
        auditType,
        scope: scope.trim() || null,
        financialYear: financialYear.trim() || null,
        auditorName: auditorName.trim() || null,
        authority: authority.trim() || null,
        plannedOn: plannedOn || null,
      })
      .then(() => {
        onCreated();
        onClose();
      })
      .catch((err: any) => window.alert(err?.message ?? 'The audit could not be created'))
      .finally(() => setSaving(false));
  };

  return (
    <ModalShell
      title="New compliance audit"
      subtitle="Groups findings under one inspection so they can be closed together"
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY} disabled={saving}>
            Cancel
          </button>
          <button onClick={submit} className={BTN_PRIMARY} disabled={saving || !title.trim()}>
            {saving ? 'Creating…' : 'Create audit'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className={LABEL_CLS} htmlFor="aud-title">
            Title
          </label>
          <input id="aud-title" className={INPUT_CLS} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS} htmlFor="aud-type">
              Type
            </label>
            <select id="aud-type" className={INPUT_CLS} value={auditType} onChange={(e) => setAuditType(e.target.value)}>
              {AUDIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="aud-fy">
              Financial year
            </label>
            <input
              id="aud-fy"
              className={INPUT_CLS}
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
              placeholder="2026-2027"
            />
          </div>
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="aud-scope">
            Scope
          </label>
          <textarea id="aud-scope" rows={2} className={INPUT_CLS} value={scope} onChange={(e) => setScope(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS} htmlFor="aud-auditor">
              Auditor
            </label>
            <input
              id="aud-auditor"
              className={INPUT_CLS}
              value={auditorName}
              onChange={(e) => setAuditorName(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="aud-authority">
              Authority
            </label>
            <input
              id="aud-authority"
              className={INPUT_CLS}
              value={authority}
              onChange={(e) => setAuthority(e.target.value)}
              placeholder="EPFO, ESIC, …"
            />
          </div>
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="aud-planned">
            Planned on
          </label>
          <input
            id="aud-planned"
            type="date"
            className={INPUT_CLS}
            value={plannedOn}
            onChange={(e) => setPlannedOn(e.target.value)}
          />
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Action status control
// ---------------------------------------------------------------------------

function ActionStatusPicker({ action, onChanged }: { action: Action; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);

  const update = (status: string) => {
    if (!status || status === action.status) return;
    setSaving(true);
    complianceApi
      .updateAction(action.id, { status })
      .then(() => onChanged())
      .catch((err: any) => window.alert(err?.message ?? 'The action could not be updated'))
      .finally(() => setSaving(false));
  };

  return (
    <select
      className={`${INPUT_CLS} py-1 text-xs w-36`}
      value={String(action.status ?? 'PENDING')}
      disabled={saving}
      onChange={(e) => update(e.target.value)}
      aria-label="Corrective action status"
    >
      {ACTION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Finding detail
// ---------------------------------------------------------------------------

function FindingDetailModal({
  finding,
  onClose,
  onChanged,
}: {
  finding: Finding;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [guard, setGuard] = useState<string | null>(null);

  const [actionText, setActionText] = useState('');
  const [actionType, setActionType] = useState('CORRECTIVE');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [adding, setAdding] = useState(false);

  const loadActions = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    complianceApi
      .findingActions(finding.id)
      .then((rows) => setActions(Array.isArray(rows) ? (rows as Action[]) : []))
      .catch((err: any) => setLoadError(err?.message ?? 'Could not load corrective actions'))
      .finally(() => setLoading(false));
  }, [finding.id]);

  useEffect(() => {
    loadActions();
  }, [loadActions]);

  const closeFinding = () => {
    setClosing(true);
    setGuard(null);
    complianceApi
      .closeFinding(finding.id, closeNote.trim() || undefined)
      .then(() => {
        onChanged();
        onClose();
      })
      .catch((err: any) => {
        const message = err?.message ?? 'The finding could not be closed';
        setGuard(message);
        window.alert(message);
      })
      .finally(() => setClosing(false));
  };

  const addAction = () => {
    setAdding(true);
    complianceApi
      .addAction(finding.id, {
        actionText: actionText.trim(),
        actionType,
        ownerUserId: ownerUserId ? Number(ownerUserId) : null,
        dueDate: dueDate || null,
      })
      .then(() => {
        setActionText('');
        setOwnerUserId('');
        setDueDate('');
        loadActions();
        onChanged();
      })
      .catch((err: any) => window.alert(err?.message ?? 'The corrective action could not be added'))
      .finally(() => setAdding(false));
  };

  const openCount = actions.filter((a) => OPEN_ACTION_STATUSES.has(String(a.status ?? ''))).length;

  return (
    <ModalShell
      title={finding.title ?? `Finding #${finding.id}`}
      subtitle={`${finding.findingNo ?? `#${finding.id}`} · ${finding.category ?? '—'} · identified ${fmtDate(finding.identifiedOn)}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-text-muted text-[11px]">
            {openCount > 0
              ? `${openCount} corrective action(s) still open — the backend will refuse to close this finding.`
              : 'No outstanding corrective actions.'}
          </span>
          <button onClick={closeFinding} className={BTN_PRIMARY} disabled={closing || finding.status === 'CLOSED'}>
            {finding.status === 'CLOSED' ? 'Already closed' : closing ? 'Closing…' : 'Close finding'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {finding.severity && (
            <Chip label={String(finding.severity)} tone={SEVERITY_TONE[String(finding.severity)] ?? 'default'} />
          )}
          {finding.status && (
            <Chip
              label={String(finding.status).replace(/_/g, ' ')}
              tone={FINDING_STATUS_TONE[String(finding.status)] ?? 'default'}
              dot
            />
          )}
          {finding.isAutomated && (
            <span className="inline-flex items-center gap-1 text-info text-xs">
              <Cpu size={13} /> Raised automatically{finding.ruleCode ? ` from ${finding.ruleCode}` : ''}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat label="Affected" value={String(Number(finding.affectedCount ?? 0))} danger={Number(finding.affectedCount ?? 0) > 0} />
          <MiniStat
            label="Financial impact"
            value={finding.financialImpact === null || finding.financialImpact === undefined ? '—' : inr(Number(finding.financialImpact))}
          />
          <MiniStat label="Owner" value={finding.ownerName ?? (finding.ownerUserId ? `user #${finding.ownerUserId}` : '—')} />
          <MiniStat label="Due" value={fmtDate(finding.dueDate)} />
        </div>

        {finding.description && (
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold mb-1">Description</p>
            <p className="text-text-secondary text-xs leading-relaxed whitespace-pre-line">{finding.description}</p>
          </div>
        )}

        {guard && (
          <div className="px-3 py-2 rounded-md bg-danger-light border border-danger/30 text-danger text-xs flex items-start gap-2">
            <AlertOctagon size={14} className="flex-shrink-0 mt-0.5" />
            <span>{guard}</span>
          </div>
        )}

        {/* Corrective actions ---------------------------------------------- */}
        <div className="space-y-2">
          <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5">
            <ListChecks size={13} /> Corrective actions
          </p>

          {loading && <LoadingBlock label="Loading actions…" />}
          {loadError && <ErrorBlock message={loadError} />}
          {!loading && !loadError && actions.length === 0 && (
            <p className="text-text-muted text-xs">No corrective actions recorded yet.</p>
          )}

          <div className="space-y-2">
            {actions.map((a) => {
              const overdue = !!a.dueDate && String(a.dueDate).slice(0, 10) < todayISO();
              return (
                <div
                  key={a.id}
                  className={`px-3 py-2 rounded-md border ${
                    overdue && OPEN_ACTION_STATUSES.has(String(a.status ?? ''))
                      ? 'border-danger/30 bg-danger-light'
                      : 'border-border-light bg-bg-secondary'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-text-primary text-xs">{a.actionText ?? '—'}</p>
                      <p className="text-text-muted text-[11px] mt-0.5">
                        {a.actionType ?? '—'} · owner {a.ownerName ?? (a.ownerUserId ? `user #${a.ownerUserId}` : '—')} ·
                        due {fmtDate(a.dueDate)}
                        {a.completedOn ? ` · completed ${fmtDate(a.completedOn)}` : ''}
                      </p>
                    </div>
                    <ActionStatusPicker
                      action={a}
                      onChanged={() => {
                        loadActions();
                        onChanged();
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add form ------------------------------------------------------ */}
          <div className="rounded-md border border-border-light p-3 space-y-2">
            <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">Add corrective action</p>
            <textarea
              className={INPUT_CLS}
              rows={2}
              value={actionText}
              onChange={(e) => setActionText(e.target.value)}
              placeholder="What will be done to fix this"
              aria-label="Action text"
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className={LABEL_CLS} htmlFor="act-type">
                  Type
                </label>
                <select id="act-type" className={INPUT_CLS} value={actionType} onChange={(e) => setActionType(e.target.value)}>
                  <option value="CORRECTIVE">CORRECTIVE</option>
                  <option value="PREVENTIVE">PREVENTIVE</option>
                </select>
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="act-owner">
                  Owner user id
                </label>
                <input
                  id="act-owner"
                  className={INPUT_CLS}
                  value={ownerUserId}
                  onChange={(e) => setOwnerUserId(e.target.value.replace(/\D/g, ''))}
                  placeholder="optional"
                />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="act-due">
                  Due date
                </label>
                <input
                  id="act-due"
                  type="date"
                  className={INPUT_CLS}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
            <button onClick={addAction} className={BTN_SECONDARY} disabled={adding || !actionText.trim()}>
              <Plus size={14} className="inline mr-1.5" />
              {adding ? 'Adding…' : 'Add action'}
            </button>
          </div>
        </div>

        {/* Close note ------------------------------------------------------ */}
        <div>
          <label className={LABEL_CLS} htmlFor="fnd-note">
            Closing note (optional)
          </label>
          <textarea
            id="fnd-note"
            className={INPUT_CLS}
            rows={2}
            value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)}
            placeholder="Appended to the finding's description when it closes"
          />
        </div>
      </div>
    </ModalShell>
  );
}

function MiniStat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-md border border-border-light bg-bg-secondary px-3 py-2">
      <p className="text-text-muted text-[10px] uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-medium tabular-nums ${danger ? 'text-danger' : 'text-text-primary'}`}>{value}</p>
    </div>
  );
}
