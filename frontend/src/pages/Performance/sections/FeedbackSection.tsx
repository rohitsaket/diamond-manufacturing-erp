import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Award, Gift, MessageSquarePlus, Star } from 'lucide-react';
import { talentApi } from '../../../api/performance';
import { api } from '../../../api/client';
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
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// talentApi's redemption helpers point at /talent/redemptions/:id/*, but the
// backend serves /talent/rewards/redemptions/:id/*. These wrappers use the
// verified routes.
// ---------------------------------------------------------------------------
const rewardsFix = {
  decide: (id: number, body: { approve: boolean; note?: string | null }) =>
    api.put<any>(`/talent/rewards/redemptions/${id}/decide`, body),
  fulfill: (id: number) => api.put<any>(`/talent/rewards/redemptions/${id}/fulfill`, {}),
};

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const FEEDBACK_TYPES = ['FEEDBACK', 'APPRECIATION', 'COACHING', 'SUGGESTION', 'IMPROVEMENT'];
const VISIBILITIES = ['PRIVATE', 'MANAGER', 'PUBLIC'];
const AWARD_TYPES = ['SPOT', 'ACHIEVEMENT', 'MILESTONE', 'SERVICE', 'TEAM', 'CUSTOM'];
const REDEMPTION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'FULFILLED'];

const TYPE_TONE: Record<string, Tone> = {
  FEEDBACK: 'default',
  APPRECIATION: 'success',
  COACHING: 'info',
  SUGGESTION: 'primary',
  IMPROVEMENT: 'warning',
};

const REDEMPTION_TONE: Record<string, Tone> = {
  PENDING: 'warning',
  APPROVED: 'info',
  REJECTED: 'danger',
  FULFILLED: 'success',
};

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function fmtDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

// ---------------------------------------------------------------------------

export function FeedbackSection() {
  const [tab, setTab] = useState('wall');

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: 'wall', label: 'Feedback Wall' },
          { id: 'recognition', label: 'Recognition' },
          { id: 'rewards', label: 'Rewards' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'wall' && <WallTab />}
      {tab === 'recognition' && <RecognitionTab />}
      {tab === 'rewards' && <RewardsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback wall
// ---------------------------------------------------------------------------

function WallTab() {
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [giveOpen, setGiveOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .feedback(typeFilter === 'ALL' ? {} : { feedbackType: typeFilter })
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = rows.filter((r) => typeFilter === 'ALL' || r?.feedbackType === typeFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {['ALL', ...FEEDBACK_TYPES].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                t === typeFilter
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button type="button" className={BTN_PRIMARY} onClick={() => setGiveOpen(true)}>
          <span className="inline-flex items-center gap-1.5">
            <MessageSquarePlus size={14} /> Give feedback
          </span>
        </button>
      </div>

      {loading && <LoadingBlock label="Loading the feedback wall…" />}
      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <EmptyBlock message="No feedback for this filter" hint="Only feedback visible to your role is listed." />
      )}

      {!loading && visible.length > 0 && (
        <div className="space-y-2">
          {visible.map((f) => (
            <div key={f.id} className="bg-bg-card border border-border-default rounded-md p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Chip label={text(f.feedbackType)} tone={TYPE_TONE[f.feedbackType] ?? 'default'} />
                <Chip
                  label={text(f.visibility)}
                  tone={f.visibility === 'PUBLIC' ? 'success' : f.visibility === 'PRIVATE' ? 'default' : 'info'}
                />
                <span className="text-text-muted text-[11px] ml-auto">{fmtDate(f.createdAt)}</span>
              </div>
              <p className="text-text-primary text-sm whitespace-pre-wrap">{text(f.message)}</p>
              <p className="text-text-muted text-xs">
                From <span className="text-text-secondary">{f.isAnonymous || !f.fromName ? 'Anonymous' : f.fromName}</span> to{' '}
                <span className="text-text-secondary">{text(f.toEmployeeName)}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {giveOpen && (
          <GiveFeedbackModal
            onClose={() => setGiveOpen(false)}
            onSaved={() => {
              setGiveOpen(false);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function GiveFeedbackModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { employees } = useApp();
  const [toEmployeeId, setToEmployeeId] = useState('');
  const [feedbackType, setFeedbackType] = useState('FEEDBACK');
  const [message, setMessage] = useState('');
  const [visibility, setVisibility] = useState('MANAGER');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setBusy(true);
    setError(null);
    talentApi
      .giveFeedback({
        toEmployeeId: Number(toEmployeeId),
        feedbackType,
        message: message.trim(),
        visibility,
        isAnonymous,
      })
      .then(() => onSaved())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title="Give feedback"
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !toEmployeeId || !message.trim()} onClick={save}>
            {busy ? 'Sending…' : 'Send feedback'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Employee</label>
            <select className={INPUT_CLS} value={toEmployeeId} onChange={(e) => setToEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {(employees ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} · {emp.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Type</label>
            <select className={INPUT_CLS} value={feedbackType} onChange={(e) => setFeedbackType(e.target.value)}>
              {FEEDBACK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Visibility</label>
            <select className={INPUT_CLS} value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              {VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
              Anonymous
            </label>
          </div>
        </div>
        <div>
          <label className={LABEL_CLS}>Message</label>
          <textarea className={INPUT_CLS} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

function RecognitionTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [giveOpen, setGiveOpen] = useState(false);
  const [successNote, setSuccessNote] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .recognitions()
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className={BTN_PRIMARY} onClick={() => setGiveOpen(true)}>
          <span className="inline-flex items-center gap-1.5">
            <Award size={14} /> Recognize
          </span>
        </button>
      </div>

      {successNote && (
        <div className="rounded-md bg-warning-light border border-warning/30 px-3 py-2 flex items-start justify-between gap-3">
          <p className="text-text-primary text-xs">{successNote}</p>
          <button type="button" className="text-text-muted text-xs hover:text-text-primary" onClick={() => setSuccessNote(null)}>
            Dismiss
          </button>
        </div>
      )}

      {loading && <LoadingBlock label="Loading recognitions…" />}
      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && <EmptyBlock message="No recognitions yet" />}

      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((r) => (
            <div key={r.id} className="bg-bg-card border border-border-default rounded-md p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Chip label={text(r.awardType)} tone="primary" />
                {r.isPublic === false && <Chip label="Private" tone="default" />}
                <span className="text-text-muted text-[11px] ml-auto">{fmtDate(r.awardedAt)}</span>
              </div>
              <p className="text-text-primary text-sm font-semibold">{text(r.title)}</p>
              {r.citation && <p className="text-text-secondary text-xs">{r.citation}</p>}
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-text-secondary">{text(r.employeeName)}</span>
                {Number(r.points ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success-light text-success text-[11px] font-medium">
                    <Star size={11} /> {Number(r.points)} pts
                  </span>
                )}
                {r.monetaryAmount !== null && r.monetaryAmount !== undefined && (
                  <Chip label={inr(Number(r.monetaryAmount))} tone="warning" />
                )}
                <span className="text-text-muted text-[11px] ml-auto">by {text(r.awardedByName)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {giveOpen && (
          <RecognizeModal
            onClose={() => setGiveOpen(false)}
            onSaved={(note) => {
              setGiveOpen(false);
              setSuccessNote(note);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function RecognizeModal({ onClose, onSaved }: { onClose: () => void; onSaved: (note: string | null) => void }) {
  const { employees } = useApp();
  const [employeeId, setEmployeeId] = useState('');
  const [awardType, setAwardType] = useState('SPOT');
  const [title, setTitle] = useState('');
  const [citation, setCitation] = useState('');
  const [points, setPoints] = useState('');
  const [monetaryAmount, setMonetaryAmount] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setBusy(true);
    setError(null);
    talentApi
      .giveRecognition({
        employeeId: Number(employeeId),
        awardType,
        title: title.trim(),
        citation: citation.trim() || null,
        points: points === '' ? 0 : Number(points),
        monetaryAmount: monetaryAmount === '' ? null : Number(monetaryAmount),
        isPublic,
      })
      // A monetary award does NOT auto-create a payroll pay award — the
      // response says so and that note must reach the user.
      .then((res) => onSaved(res?.note ? String(res.note) : null))
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title="Recognize an employee"
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !employeeId || !title.trim()} onClick={save}>
            {busy ? 'Saving…' : 'Give recognition'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Employee</label>
            <select className={INPUT_CLS} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {(employees ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} · {emp.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Award type</label>
            <select className={INPUT_CLS} value={awardType} onChange={(e) => setAwardType(e.target.value)}>
              {AWARD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={LABEL_CLS}>Title</label>
            <input className={INPUT_CLS} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={LABEL_CLS}>Citation</label>
            <textarea className={INPUT_CLS} rows={2} value={citation} onChange={(e) => setCitation(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Reward points</label>
            <input type="number" min={0} className={INPUT_CLS} value={points} onChange={(e) => setPoints(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Monetary amount (₹, optional)</label>
            <input
              type="number"
              min={0}
              className={INPUT_CLS}
              value={monetaryAmount}
              onChange={(e) => setMonetaryAmount(e.target.value)}
            />
          </div>
        </div>
        {monetaryAmount !== '' && (
          <p className="text-text-muted text-[11px]">
            The monetary payout is not applied automatically — after saving, add it in Payroll → Awards so it flows
            through a payroll run.
          </p>
        )}
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          Public recognition
        </label>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Rewards: balance, ledger, redemptions queue
// ---------------------------------------------------------------------------

function RewardsTab() {
  const { employees } = useApp();
  const [employeeId, setEmployeeId] = useState('');
  const [balance, setBalance] = useState<any>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [status, setStatus] = useState('ALL');
  const [redemptions, setRedemptions] = useState<any[]>([]);
  const [redLoading, setRedLoading] = useState(true);
  const [redError, setRedError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBalance = useCallback(() => {
    if (!employeeId) {
      setBalance(null);
      return;
    }
    setBalanceLoading(true);
    setBalanceError(null);
    talentApi
      .rewardBalance(Number(employeeId))
      .then((res) => setBalance(res ?? null))
      .catch((err) => setBalanceError(reason(err)))
      .finally(() => setBalanceLoading(false));
  }, [employeeId]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  const loadRedemptions = useCallback(() => {
    setRedLoading(true);
    setRedError(null);
    talentApi
      .redemptions(status === 'ALL' ? {} : { status })
      .then((rows) => setRedemptions(Array.isArray(rows) ? rows : []))
      .catch((err) => setRedError(reason(err)))
      .finally(() => setRedLoading(false));
  }, [status]);

  useEffect(() => {
    loadRedemptions();
  }, [loadRedemptions]);

  const fulfill = (id: number) => {
    setBusy(true);
    rewardsFix
      .fulfill(id)
      .then(() => {
        loadRedemptions();
        loadBalance();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const entries: any[] = Array.isArray(balance?.entries) ? balance.entries : [];

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border-default bg-bg-card p-4 space-y-3">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="w-64">
            <label className={LABEL_CLS} htmlFor="rw-emp">
              Employee
            </label>
            <select id="rw-emp" className={INPUT_CLS} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select an employee</option>
              {(employees ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} · {emp.fullName}
                </option>
              ))}
            </select>
          </div>
          {balance && (
            <div className="w-44">
              <StatCard label="Points balance" value={Number(balance.balance ?? 0)} intent="info" />
            </div>
          )}
        </div>

        {balanceLoading && <LoadingBlock label="Loading the balance…" />}
        {balanceError && <ErrorBlock message={balanceError} />}

        {!balanceLoading && balance && entries.length === 0 && (
          <p className="text-text-muted text-xs">No ledger entries for this employee.</p>
        )}

        {!balanceLoading && entries.length > 0 && (
          <TableShell headers={['Type', 'Points', 'Reference', 'Note', 'Date']}>
            {entries.map((e) => {
              const earned = String(e.entryType) === 'EARNED';
              return (
                <tr key={e.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(e.entryType)} tone={earned ? 'success' : 'danger'} />
                  </td>
                  <td className={`px-3 py-2 text-xs font-mono whitespace-nowrap ${earned ? 'text-success' : 'text-danger'}`}>
                    {Number(e.points) > 0 ? `+${Number(e.points)}` : Number(e.points)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{text(e.reference)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{text(e.note)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(e.createdAt)}</td>
                </tr>
              );
            })}
          </TableShell>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Gift size={15} className="text-text-muted" />
          <p className="text-text-primary text-sm font-semibold">Redemption queue</p>
          {['ALL', ...REDEMPTION_STATUSES].map((s) => (
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
              {s}
            </button>
          ))}
        </div>

        {redLoading && <LoadingBlock label="Loading redemptions…" />}
        {redError && <ErrorBlock message={redError} />}
        {!redLoading && !redError && redemptions.length === 0 && <EmptyBlock message="No redemption requests" />}

        {!redLoading && redemptions.length > 0 && (
          <TableShell headers={['Employee', 'Reward item', 'Points', 'Status', 'Requested', 'Note', 'Actions']}>
            {redemptions.map((r) => (
              <tr key={r.id} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(r.employeeName)}</td>
                <td className="px-3 py-2 text-xs text-text-secondary">{text(r.rewardItem)}</td>
                <td className="px-3 py-2 text-xs font-mono text-text-secondary">{Number(r.points ?? 0)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Chip label={text(r.status)} tone={REDEMPTION_TONE[r.status] ?? 'default'} dot />
                </td>
                <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(r.requestedAt)}</td>
                <td className="px-3 py-2 text-xs text-text-muted">{text(r.note)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {r.status === 'PENDING' && (
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline"
                        onClick={() => setDeciding(r)}
                      >
                        Decide
                      </button>
                    )}
                    {r.status === 'APPROVED' && (
                      <button
                        type="button"
                        className="text-success text-xs font-medium hover:underline disabled:opacity-40"
                        disabled={busy}
                        onClick={() => fulfill(Number(r.id))}
                      >
                        Fulfill
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </div>

      <AnimatePresence>
        {deciding && (
          <DecideRedemptionModal
            redemption={deciding}
            onClose={() => setDeciding(null)}
            onDone={() => {
              setDeciding(null);
              loadRedemptions();
              loadBalance();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function DecideRedemptionModal({
  redemption,
  onClose,
  onDone,
}: {
  redemption: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = (approve: boolean) => {
    setBusy(true);
    setError(null);
    rewardsFix
      .decide(Number(redemption.id), { approve, note: note.trim() || null })
      .then(() => onDone())
      // An insufficient-balance rejection comes back as a 409 whose message
      // must be surfaced verbatim.
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title={`Redemption — ${text(redemption.employeeName)}`}
      subtitle={`${text(redemption.rewardItem)} · ${Number(redemption.points ?? 0)} points`}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => decide(false)}>
            Reject
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => decide(true)}>
            {busy ? 'Working…' : 'Approve'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}
        <p className="text-text-secondary text-xs">
          Approving deducts {Number(redemption.points ?? 0)} points from the employee&rsquo;s balance. The backend
          re-checks the balance at approval time and refuses with a conflict if it is insufficient.
        </p>
        <div>
          <label className={LABEL_CLS}>Note (optional)</label>
          <textarea className={INPUT_CLS} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </ModalShell>
  );
}
