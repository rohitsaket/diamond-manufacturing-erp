import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Info, Medal, Trophy } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { internalHiringApi, internalJobsApi } from '../../../api/internalJobs';
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
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const STATUS_FILTERS = ['ALL', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'HIRED', 'REJECTED', 'WITHDRAWN'];

const STATUS_TONE: Record<string, Tone> = {
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  ACCEPTED: 'primary',
  HIRED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'default',
};

const TOOLTIP_STYLE = {
  background: 'var(--color-bg-card)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 6,
  fontSize: 12,
} as const;

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

/** Medal colours for the top three; plain rank number below that. */
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Medal size={16} className="text-warning" aria-label="Rank 1" />;
  if (rank === 2) return <Medal size={16} className="text-text-muted" aria-label="Rank 2" />;
  if (rank === 3) return <Medal size={16} className="text-danger" aria-label="Rank 3" />;
  return <span className="text-text-muted text-xs font-mono">#{rank}</span>;
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function ReferralsSection() {
  const [status, setStatus] = useState('ALL');
  const [rows, setRows] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      internalJobsApi.referrals(status === 'ALL' ? {} : { status }),
      internalJobsApi.referralLeaderboard().catch(() => []),
      internalHiringApi.referralAnalytics().catch(() => null),
    ])
      .then(([list, lb, an]) => {
        setRows(Array.isArray(list) ? list : []);
        setLeaderboard(Array.isArray(lb) ? lb : []);
        setAnalytics(an ?? null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const months: any[] = Array.isArray(analytics?.months) ? analytics.months : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
              s === status
                ? 'bg-primary-light border-primary/30 text-primary'
                : 'border-border-default text-text-muted hover:border-text-muted'
            }`}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {loading && <LoadingBlock label="Loading referrals…" />}
      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
          {/* Review queue --------------------------------------------------- */}
          <div className="space-y-4 min-w-0">
            {rows.length === 0 ? (
              <EmptyBlock message="No referrals for this filter" />
            ) : (
              <TableShell headers={['Referrer', 'Referred', 'Kind', 'Job', 'Points', 'Status', '']}>
                {rows.map((r) => {
                  const kind = r?.referredEmployeeId ? 'INTERNAL' : 'EXTERNAL';
                  const who = r?.referredName ?? r?.externalName ?? '—';
                  const reviewable = ['SUBMITTED', 'UNDER_REVIEW'].includes(String(r?.status));
                  return (
                    <tr key={r.id} className="hover:bg-bg-hover transition-colors">
                      <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(r.referrerName)}</td>
                      <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                        {text(who)}
                        {kind === 'EXTERNAL' && (r.externalPhone || r.externalEmail) && (
                          <span className="block text-text-muted text-[10px]">
                            {[r.externalPhone, r.externalEmail].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Chip label={kind} tone={kind === 'INTERNAL' ? 'info' : 'default'} />
                      </td>
                      <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                        {r.jobTitle ? String(r.jobTitle) : <span className="text-text-muted">General</span>}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary whitespace-nowrap">
                        {Number(r.rewardPoints ?? 0) > 0 ? r.rewardPoints : '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Chip label={String(r.status ?? '—').replace(/_/g, ' ')} tone={STATUS_TONE[r.status] ?? 'default'} dot />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {reviewable && (
                          <button
                            type="button"
                            className="text-primary text-xs font-medium hover:underline"
                            onClick={() => setReviewing(r)}
                          >
                            Review
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </TableShell>
            )}

            {/* Analytics chart --------------------------------------------- */}
            <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-2">
              <p className="text-text-primary text-sm font-semibold">Referrals by month</p>
              {months.length === 0 ? (
                <EmptyBlock message="No referral activity yet" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={months} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--color-border-light)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" width={32} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="total" name="Total" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="hired" name="Hired" fill="var(--color-success)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Leaderboard ----------------------------------------------------- */}
          <div className="bg-bg-card border border-border-default rounded-md p-4 h-fit space-y-3">
            <p className="text-text-primary text-sm font-semibold inline-flex items-center gap-1.5">
              <Trophy size={15} className="text-warning" /> Referral leaderboard
            </p>
            {leaderboard.length === 0 ? (
              <p className="text-text-muted text-xs">No hired referrals yet — the board fills as referrals convert.</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[24px_minmax(0,1fr)_repeat(3,44px)] gap-2 text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                  <span />
                  <span>Referrer</span>
                  <span className="text-right">Total</span>
                  <span className="text-right">Hired</span>
                  <span className="text-right">Pts</span>
                </div>
                {leaderboard.map((row) => (
                  <div
                    key={row.referrerEmployeeId}
                    className="grid grid-cols-[24px_minmax(0,1fr)_repeat(3,44px)] gap-2 items-center rounded-md border border-border-light bg-bg-secondary px-2 py-1.5"
                  >
                    <RankBadge rank={Number(row.rank)} />
                    <div className="min-w-0">
                      <p className="text-text-primary text-xs font-medium truncate">{text(row.referrerName)}</p>
                      <p className="text-text-muted text-[10px] font-mono">{text(row.empCode)}</p>
                    </div>
                    <span className="text-right text-xs font-mono text-text-secondary">{Number(row.total ?? 0)}</span>
                    <span className="text-right text-xs font-mono text-success">{Number(row.hired ?? 0)}</span>
                    <span className="text-right text-xs font-mono text-text-primary">{Number(row.totalPoints ?? 0)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-text-muted text-[10px]">
              Points are granted when a referred person is actually hired, not on submission.
            </p>
          </div>
        </div>
      )}

      <AnimatePresence>
        {reviewing && (
          <ReviewModal
            referral={reviewing}
            onClose={() => setReviewing(null)}
            onDone={() => {
              setReviewing(null);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review modal
// ---------------------------------------------------------------------------

function ReviewModal({
  referral,
  onClose,
  onDone,
}: {
  referral: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The accept response for an external referral names the candidates-pipeline
  // row it created — that sentence is rendered verbatim before closing.
  const [responseNote, setResponseNote] = useState<string | null>(null);

  const kind = referral?.referredEmployeeId ? 'INTERNAL' : 'EXTERNAL';
  const who = referral?.referredName ?? referral?.externalName ?? '—';

  const review = (action: 'accept' | 'reject') => {
    setBusy(true);
    setError(null);
    internalJobsApi
      .reviewReferral(Number(referral.id), { action, note: note.trim() || undefined })
      .then((res) => {
        if (res?.note) setResponseNote(String(res.note));
        else onDone();
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title={`Review referral — ${text(who)}`}
      subtitle={`Referred by ${text(referral?.referrerName)} · ${kind}${referral?.jobTitle ? ` · ${referral.jobTitle}` : ''}`}
      onClose={responseNote ? onDone : onClose}
      maxWidth="max-w-md"
      footer={
        responseNote ? (
          <div className="flex items-center justify-end">
            <button type="button" className={BTN_PRIMARY} onClick={onDone}>
              Done
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => review('reject')}>
              Reject
            </button>
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => review('accept')}>
              {busy ? 'Working…' : 'Accept referral'}
            </button>
          </div>
        )
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}

        {responseNote ? (
          <div className="rounded-md bg-success-light border border-success/30 px-3 py-2 flex items-start gap-2">
            <Info size={14} className="text-success flex-shrink-0 mt-0.5" />
            <p className="text-text-secondary text-xs">{responseNote}</p>
          </div>
        ) : (
          <>
            {referral?.note && (
              <div>
                <p className={LABEL_CLS}>Referrer's note</p>
                <p className="text-text-secondary text-xs">{String(referral.note)}</p>
              </div>
            )}
            {kind === 'EXTERNAL' && (
              <div>
                <p className={LABEL_CLS}>External contact</p>
                <p className="text-text-secondary text-xs">
                  {[referral?.externalPhone, referral?.externalEmail].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
            )}
            <div>
              <label className={LABEL_CLS}>Review note (optional)</label>
              <textarea className={INPUT_CLS} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="text-text-muted text-[11px]">
              {kind === 'INTERNAL'
                ? 'Accepting invites the colleague to apply — no application is created for them.'
                : 'Accepting an external referral adds the person to the recruitment candidate pipeline.'}
            </p>
          </>
        )}
      </div>
    </ModalShell>
  );
}
