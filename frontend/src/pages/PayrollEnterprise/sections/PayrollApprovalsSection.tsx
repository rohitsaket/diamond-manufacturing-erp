import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Circle, RefreshCw } from 'lucide-react';
import { payrollAdminApi } from '../../../api/payroll';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
  TableShell,
  inr,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { TabBar } from '../../../components/common/TabBar';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : inr(n);
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
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function stamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

function statusTone(status: string | null | undefined): Tone {
  const s = String(status ?? '').toUpperCase();
  if (s === 'APPROVED') return 'success';
  if (s === 'REJECTED' || s === 'CANCELLED') return 'danger';
  if (s === 'PENDING') return 'warning';
  return 'default';
}

/**
 * The payroll approval queue.
 *
 * Server refusals ("Your role cannot approve this step", "The same user cannot
 * approve consecutive steps") are surfaced word for word — paraphrasing a
 * control failure is how controls get worked around.
 */
export function PayrollApprovalsSection() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [entityFilter, setEntityFilter] = useState('ALL');
  const [selected, setSelected] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [rejecting, setRejecting] = useState<any | null>(null);
  const [comment, setComment] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    payrollAdminApi
      .pendingApprovals()
      .then((res) => setRows(Array.isArray(res) ? res : []))
      .catch((err: any) => setError(err?.message ?? 'Could not load pending approvals'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const t = String(r?.entityType ?? '').trim();
      if (t) set.add(t);
    }
    return [...set].sort();
  }, [rows]);

  const tabs = useMemo(
    () => [
      { id: 'ALL', label: 'All', count: rows.length },
      ...entityTypes.map((t) => ({
        id: t,
        label: t.replace(/_/g, ' ').toLowerCase(),
        count: rows.filter((r) => r?.entityType === t).length,
      })),
    ],
    [rows, entityTypes],
  );

  const visible = entityFilter === 'ALL' ? rows : rows.filter((r) => r?.entityType === entityFilter);

  const openHistory = (row: any) => {
    setSelected(row);
    setHistory([]);
    const type = String(row?.entityType ?? '');
    const id = num(row?.entityId);
    if (!type || id === null) return;
    setHistoryLoading(true);
    payrollAdminApi
      .approvalsForEntity(type, id)
      .then((res) => setHistory(Array.isArray(res) ? res : []))
      .catch((err: any) => window.alert(err?.message ?? 'Could not load the approval history'))
      .finally(() => setHistoryLoading(false));
  };

  const act = (row: any, action: 'APPROVE' | 'REJECT', comments?: string) => {
    const id = num(row?.id);
    if (id === null) return;
    setBusy(true);
    payrollAdminApi
      .actOnApproval(id, { action, comments })
      .then(() => {
        setRejecting(null);
        setComment('');
        if (selected && num(selected.id) === id) setSelected(null);
        load();
      })
      // The server's wording is the control's wording — pass it through as-is.
      .catch((err: any) => window.alert(err?.message ?? 'The approval could not be recorded'))
      .finally(() => setBusy(false));
  };

  // The request whose ladder we are drawing: prefer the exact request, fall
  // back to the newest one on the entity.
  const detailRequest =
    history.find((h: any) => num(h?.id) === num(selected?.id)) ?? history[0] ?? selected ?? null;

  const steps: any[] = Array.isArray(detailRequest?.steps) ? detailRequest.steps : [];
  const actions: any[] = Array.isArray(detailRequest?.history) ? detailRequest.history : [];
  const currentStep = num(detailRequest?.currentStep) ?? 0;

  if (loading && rows.length === 0) return <LoadingBlock label="Loading approvals…" />;

  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBlock message={error} />
        <button onClick={load} className={BTN_SECONDARY}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TabBar tabs={tabs} active={entityFilter} onChange={setEntityFilter} />
        <button onClick={load} className={BTN_SECONDARY} disabled={loading}>
          <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyBlock message="No approvals waiting on you" />
      ) : (
        <TableShell headers={['Entity', 'Title', 'Amount', 'Requested by', 'Current step', 'Age', '']}>
          {visible.map((r: any) => (
            <tr
              key={r?.id}
              onClick={() => openHistory(r)}
              className={`hover:bg-bg-hover transition-colors cursor-pointer ${
                num(selected?.id) === num(r?.id) ? 'bg-bg-selected' : ''
              }`}
            >
              <td className="px-3 py-2">
                <Chip label={String(r?.entityType ?? '—')} tone="primary" />
              </td>
              <td className="px-3 py-2 text-sm text-text-primary">{String(r?.title ?? '—')}</td>
              <td className="px-3 py-2 text-sm text-right font-mono text-text-primary">{money(r?.amount)}</td>
              <td className="px-3 py-2 text-sm text-text-secondary">{String(r?.requestedByName ?? '—')}</td>
              <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                {String(r?.currentStepName ?? `Step ${num(r?.currentStep) ?? '—'}`)}
              </td>
              <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{timeAgo(r?.createdAt)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    act(r, 'APPROVE');
                  }}
                  disabled={busy}
                  className="text-success text-xs font-medium hover:underline disabled:opacity-50 mr-3"
                >
                  Approve
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setRejecting(r);
                    setComment('');
                  }}
                  disabled={busy}
                  className="text-danger text-xs font-medium hover:underline disabled:opacity-50"
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {/* Step ladder ------------------------------------------------------- */}
      {selected && (
        <div className="bg-bg-card border border-border-default rounded-md">
          <div className="px-4 py-3 border-b border-border-default flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-text-primary text-sm font-semibold truncate">{String(selected.title ?? '')}</h3>
              <p className="text-text-muted text-[11px]">
                {String(selected.entityType ?? '')} #{num(selected.entityId) ?? '—'} · {money(selected.amount)} ·
                raised {timeAgo(selected.createdAt)}
              </p>
            </div>
            <button onClick={() => setSelected(null)} className="text-text-muted text-xs hover:text-text-primary">
              Close
            </button>
          </div>

          <div className="p-4">
            {historyLoading && <LoadingBlock label="Loading approval history…" />}

            {!historyLoading && steps.length === 0 && (
              <EmptyBlock message="No approval ladder is attached to this request" />
            )}

            {!historyLoading && steps.length > 0 && (
              <ol className="space-y-0">
                {steps.map((step: any, i: number) => {
                  const order = num(step?.stepOrder) ?? i + 1;
                  const done = order < currentStep;
                  const isCurrent = order === currentStep;
                  const acted = actions.find((a: any) => (num(a?.stepOrder) ?? -1) === order) ?? null;
                  const last = i === steps.length - 1;

                  return (
                    <li key={step?.id ?? order} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 ${
                            done
                              ? 'bg-success-light border-success/30 text-success'
                              : isCurrent
                                ? 'bg-primary-light border-primary/30 text-primary'
                                : 'bg-bg-secondary border-border-default text-text-muted'
                          }`}
                        >
                          {done ? <Check size={13} /> : <Circle size={9} />}
                        </span>
                        {!last && <span className="w-px flex-1 bg-border-light my-1" />}
                      </div>

                      <div className={`pb-4 min-w-0 ${isCurrent ? '' : done ? '' : 'opacity-60'}`}>
                        <p
                          className={`text-sm font-medium ${
                            isCurrent ? 'text-primary' : done ? 'text-text-primary' : 'text-text-muted'
                          }`}
                        >
                          {String(step?.name ?? `Step ${order}`)}
                          {isCurrent && <span className="ml-2 text-[10px] uppercase tracking-wider">current</span>}
                        </p>
                        <p className="text-text-muted text-[11px]">
                          Approver role: {String(step?.approverRole ?? '—')}
                          {Array.isArray(step?.allowedUserRoles) && step.allowedUserRoles.length > 0 && (
                            <span> ({step.allowedUserRoles.join(', ')})</span>
                          )}
                        </p>
                        {acted && (
                          <p className="text-text-secondary text-[11px] mt-0.5">
                            {String(acted?.action ?? '')} by {String(acted?.actedByName ?? 'unknown')} ·{' '}
                            {stamp(acted?.actedAt)}
                            {acted?.comments && <span className="italic"> — “{String(acted.comments)}”</span>}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {detailRequest?.status && (
              <div className="pt-2">
                <Chip label={String(detailRequest.status)} tone={statusTone(detailRequest.status)} dot />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reject modal ------------------------------------------------------ */}
      {rejecting && (
        <ModalShell
          title="Reject this request"
          subtitle={String(rejecting.title ?? '')}
          onClose={() => setRejecting(null)}
          maxWidth="max-w-md"
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setRejecting(null)} className={BTN_SECONDARY}>
                Cancel
              </button>
              <button
                onClick={() => act(rejecting, 'REJECT', comment.trim())}
                className={BTN_PRIMARY}
                disabled={busy || !comment.trim()}
              >
                Reject
              </button>
            </div>
          }
        >
          <label className={LABEL_CLS} htmlFor="approval-comment">
            Reason
          </label>
          <textarea
            id="approval-comment"
            rows={4}
            className={INPUT_CLS}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Why is this being rejected? The requester sees this."
          />
          <p className="text-text-muted text-[11px] mt-2">
            Rejection ends the request outright — there is no partial rejection in payroll.
          </p>
        </ModalShell>
      )}
    </div>
  );
}
