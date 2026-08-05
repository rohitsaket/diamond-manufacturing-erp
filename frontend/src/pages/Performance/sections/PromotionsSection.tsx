import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ArrowRight, Award, Download, ListChecks, Plus } from 'lucide-react';
import { performanceApi, talentApi } from '../../../api/performance';
import { openAuthenticatedFile } from '../../../api/payroll';
import { orgApi } from '../../../api/organization';
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
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const PROMOTION_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EFFECTED'];

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'default',
  PENDING_APPROVAL: 'info',
  APPROVED: 'primary',
  REJECTED: 'danger',
  EFFECTED: 'success',
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

function salaryImpact(r: any): string {
  const parts: string[] = [];
  if (r?.salaryImpactPct !== null && r?.salaryImpactPct !== undefined) parts.push(`${Number(r.salaryImpactPct)}%`);
  if (r?.salaryImpactAmount !== null && r?.salaryImpactAmount !== undefined) parts.push(inr(Number(r.salaryImpactAmount)));
  return parts.length > 0 ? parts.join(' · ') : '—';
}

// ---------------------------------------------------------------------------

export function PromotionsSection() {
  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [status, setStatus] = useState('ALL');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [eligOpen, setEligOpen] = useState(false);
  const [elig, setElig] = useState<any>(null);
  const [eligLoading, setEligLoading] = useState(false);
  const [eligError, setEligError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);

  useEffect(() => {
    performanceApi
      .cycles()
      .then((list) => {
        const arr = Array.isArray(list) ? list : [];
        setCycles(arr);
        const annual = arr.find((c) => c?.status === 'ACTIVE' && c?.cycleType === 'ANNUAL') ?? arr[0];
        if (annual?.id) setCycleId(Number(annual.id));
      })
      .catch(() => setCycles([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .promotions()
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!eligOpen) return;
    setEligLoading(true);
    setEligError(null);
    talentApi
      .promotionEligibility(cycleId ?? undefined)
      .then((res) => setElig(res ?? null))
      .catch((err) => setEligError(reason(err)))
      .finally(() => setEligLoading(false));
  }, [eligOpen, cycleId]);

  const filtered = rows.filter((r) => status === 'ALL' || r?.status === status);
  const criteria: string[] = Array.isArray(elig?.criteria) ? elig.criteria.map(String) : [];
  const eligible: any[] = Array.isArray(elig?.employees) ? elig.employees : [];

  if (loading) return <LoadingBlock label="Loading promotions…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {['ALL', ...PROMOTION_STATUSES].map((s) => (
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
        <div className="flex items-center gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={() => setEligOpen((v) => !v)}>
            <span className="inline-flex items-center gap-1.5">
              <ListChecks size={14} /> Eligibility
            </span>
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={() => setCreateOpen(true)}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} /> New promotion
            </span>
          </button>
        </div>
      </div>

      {eligOpen && (
        <div className="rounded-md border border-border-default bg-bg-card p-4 space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <p className="text-text-primary text-sm font-semibold">Promotion eligibility</p>
            <div className="w-56">
              <label className={LABEL_CLS} htmlFor="pe-cycle">
                Cycle
              </label>
              <select
                id="pe-cycle"
                className={INPUT_CLS}
                value={cycleId ?? ''}
                onChange={(e) => setCycleId(e.target.value ? Number(e.target.value) : null)}
              >
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {eligLoading && <LoadingBlock label="Computing eligibility…" />}
          {eligError && <ErrorBlock message={eligError} />}

          {!eligLoading && elig && (
            <>
              {criteria.length > 0 && (
                <p className="text-text-muted text-[11px]">
                  Basis (as stated by the backend): {criteria.join('; ')}.
                </p>
              )}
              {eligible.length === 0 ? (
                <EmptyBlock message="No employees meet the eligibility criteria in this cycle" />
              ) : (
                <TableShell headers={['Employee', 'Grade', 'Tenure', 'Final rating', 'Label', 'Recommended']}>
                  {eligible.map((e) => (
                    <tr key={e.employeeId} className="hover:bg-bg-hover transition-colors">
                      <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                        {text(e.employeeName)}
                        <span className="block text-text-muted font-mono text-[11px]">{text(e.empCode)}</span>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-text-secondary whitespace-nowrap">{text(e.grade)}</td>
                      <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                        {e.tenureYears !== null && e.tenureYears !== undefined ? `${e.tenureYears} yr` : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-text-primary">{text(e.finalRating)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {e.ratingLabel ? <Chip label={String(e.ratingLabel)} tone="primary" /> : '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {e.promotionRecommended ? <Chip label="Yes" tone="success" /> : <Chip label="No" tone="default" />}
                      </td>
                    </tr>
                  ))}
                </TableShell>
              )}
            </>
          )}
        </div>
      )}

      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!error && filtered.length === 0 && (
        <EmptyBlock message="No promotions for this filter" hint="Create a promotion case from an appraisal or directly." />
      )}

      {!error && filtered.length > 0 && (
        <TableShell headers={['Employee', 'Grade', 'Role change', 'Salary impact', 'Effective', 'Status', 'Letter']}>
          {filtered.map((r) => (
            <tr
              key={r.id}
              className="hover:bg-bg-hover transition-colors cursor-pointer"
              onClick={() => setDetail(r)}
            >
              <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(r.employeeName)}</td>
              <td className="px-3 py-2 text-xs whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5 font-mono text-text-secondary">
                  {text(r.fromGrade)} <ArrowRight size={12} className="text-text-muted" />{' '}
                  <span className="text-text-primary">{text(r.toGrade)}</span>
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                {r.fromRoleName || r.toRoleName ? `${text(r.fromRoleName)} → ${text(r.toRoleName)}` : '—'}
              </td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary whitespace-nowrap">{salaryImpact(r)}</td>
              <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(r.effectiveDate)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={text(r.status).replace(/_/g, ' ')} tone={STATUS_TONE[r.status] ?? 'default'} dot />
              </td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary whitespace-nowrap">{text(r.letterNumber)}</td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {createOpen && (
          <CreatePromotionModal
            onClose={() => setCreateOpen(false)}
            onSaved={() => {
              setCreateOpen(false);
              load();
            }}
          />
        )}
        {detail && (
          <PromotionDetailModal
            promotion={detail}
            onClose={() => setDetail(null)}
            onChanged={() => {
              setDetail(null);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function CreatePromotionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { employees } = useApp();
  const [roles, setRoles] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);

  const [employeeId, setEmployeeId] = useState('');
  const [toGrade, setToGrade] = useState('');
  const [toRoleId, setToRoleId] = useState('');
  const [toPositionId, setToPositionId] = useState('');
  const [salaryImpactPct, setSalaryImpactPct] = useState('');
  const [salaryImpactAmount, setSalaryImpactAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orgApi.jobRoles
      .list()
      .then((rows: any) => setRoles(Array.isArray(rows) ? rows : []))
      .catch(() => setRoles([]));
    orgApi.positions
      .list()
      .then((rows: any) => setPositions(Array.isArray(rows) ? rows : []))
      .catch(() => setPositions([]));
  }, []);

  const selectedEmp = (employees ?? []).find((e) => String(e.id) === employeeId);

  const save = () => {
    setBusy(true);
    setError(null);
    talentApi
      .createPromotion({
        employeeId: Number(employeeId),
        toGrade: toGrade.trim(),
        toRoleId: toRoleId ? Number(toRoleId) : undefined,
        toPositionId: toPositionId ? Number(toPositionId) : undefined,
        salaryImpactPct: salaryImpactPct === '' ? undefined : Number(salaryImpactPct),
        salaryImpactAmount: salaryImpactAmount === '' ? undefined : Number(salaryImpactAmount),
        effectiveDate: effectiveDate || undefined,
        justification: justification.trim() || undefined,
      })
      .then(() => onSaved())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title="New promotion case"
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !employeeId || !toGrade.trim()} onClick={save}>
            {busy ? 'Creating…' : 'Create draft'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            {selectedEmp && (
              <p className="text-text-muted text-[11px] mt-1">
                Current grade <span className="font-mono">{selectedEmp.grade || '—'}</span> — the from-grade is taken
                from the live employee record by the backend.
              </p>
            )}
          </div>
          <div>
            <label className={LABEL_CLS}>To grade</label>
            <input className={INPUT_CLS} value={toGrade} onChange={(e) => setToGrade(e.target.value)} placeholder="e.g. A+" />
          </div>
          <div>
            <label className={LABEL_CLS}>To role (optional)</label>
            <select className={INPUT_CLS} value={toRoleId} onChange={(e) => setToRoleId(e.target.value)}>
              <option value="">None</option>
              {roles.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name ?? r.code ?? `Role #${r.id}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>To position (optional)</label>
            <select className={INPUT_CLS} value={toPositionId} onChange={(e) => setToPositionId(e.target.value)}>
              <option value="">None</option>
              {positions.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.title ?? p.code ?? `Position #${p.id}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Salary impact %</label>
            <input
              type="number"
              min={0}
              step={0.5}
              className={INPUT_CLS}
              value={salaryImpactPct}
              onChange={(e) => setSalaryImpactPct(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Salary impact amount (₹)</label>
            <input
              type="number"
              min={0}
              className={INPUT_CLS}
              value={salaryImpactAmount}
              onChange={(e) => setSalaryImpactAmount(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Effective date</label>
            <input type="date" className={INPUT_CLS} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={LABEL_CLS}>Justification</label>
          <textarea className={INPUT_CLS} rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} />
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Detail & lifecycle
// ---------------------------------------------------------------------------

function PromotionDetailModal({
  promotion,
  onClose,
  onChanged,
}: {
  promotion: any;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);

  const id = Number(promotion.id);

  // Approve/reject/effect require the admin or hr role -- a 403 from the
  // backend is shown verbatim rather than being masked.
  const run = (fn: () => Promise<any>) => {
    setBusy(true);
    setError(null);
    fn()
      .then(() => onChanged())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  const effect = () => {
    const ok = window.confirm(
      'Effecting this promotion updates the live employee grade and writes a career timeline event in the same transaction. Continue?',
    );
    if (ok) run(() => talentApi.effectPromotion(id));
  };

  const downloadLetter = () =>
    openAuthenticatedFile(talentApi.promotionLetterUrl(id), 'promotion-letter.pdf').catch((err) => setError(reason(err)));

  const issueLetter = () => {
    setBusy(true);
    setError(null);
    talentApi
      .issuePromotionLetter(id)
      .then(() => downloadLetter())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  const status = String(promotion.status ?? '');

  return (
    <ModalShell
      title={`Promotion — ${text(promotion.employeeName)}`}
      subtitle={`${text(promotion.fromGrade)} → ${text(promotion.toGrade)}`}
      onClose={onClose}
      maxWidth="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {(status === 'APPROVED' || status === 'EFFECTED') && (
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={issueLetter}>
              <span className="inline-flex items-center gap-1.5">
                <Award size={14} /> Issue letter
              </span>
            </button>
          )}
          {promotion.letterNumber && (
            <button type="button" className={BTN_SECONDARY} onClick={downloadLetter}>
              <span className="inline-flex items-center gap-1.5">
                <Download size={14} /> Letter PDF
              </span>
            </button>
          )}
          {status === 'DRAFT' && (
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => run(() => talentApi.submitPromotion(id))}>
              Submit for approval
            </button>
          )}
          {status === 'PENDING_APPROVAL' && (
            <>
              <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => setRejectOpen(true)}>
                Reject
              </button>
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => run(() => talentApi.approvePromotion(id))}>
                Approve
              </button>
            </>
          )}
          {status === 'APPROVED' && (
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={effect}>
              Effect promotion
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBlock message={error} />}

        <div className="flex items-center gap-2 flex-wrap">
          <Chip label={status.replace(/_/g, ' ')} tone={STATUS_TONE[status] ?? 'default'} dot />
          {promotion.letterNumber && <Chip label={`Letter ${promotion.letterNumber}`} tone="info" />}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
          <div>
            <p className={LABEL_CLS}>Grade change</p>
            <p className="text-text-primary font-mono">
              {text(promotion.fromGrade)} → {text(promotion.toGrade)}
            </p>
          </div>
          <div>
            <p className={LABEL_CLS}>Role change</p>
            <p className="text-text-secondary">
              {promotion.fromRoleName || promotion.toRoleName
                ? `${text(promotion.fromRoleName)} → ${text(promotion.toRoleName)}`
                : '—'}
            </p>
          </div>
          <div>
            <p className={LABEL_CLS}>Salary impact</p>
            <p className="text-text-secondary font-mono">{salaryImpact(promotion)}</p>
          </div>
          <div>
            <p className={LABEL_CLS}>Effective date</p>
            <p className="text-text-secondary">{fmtDate(promotion.effectiveDate)}</p>
          </div>
          <div>
            <p className={LABEL_CLS}>Approved at</p>
            <p className="text-text-secondary">{fmtDate(promotion.approvedAt)}</p>
          </div>
          <div>
            <p className={LABEL_CLS}>Effected at</p>
            <p className="text-text-secondary">{fmtDate(promotion.effectedAt)}</p>
          </div>
        </div>

        <div>
          <p className={LABEL_CLS}>Justification</p>
          <p className="text-text-secondary text-xs whitespace-pre-wrap">{text(promotion.justification)}</p>
        </div>

        <p className="text-text-muted text-[11px]">
          Approve, reject and effect require the admin or hr role — other roles receive a 403 which is shown here
          verbatim.
        </p>

        {rejectOpen && (
          <div className="rounded-md border border-border-default bg-bg-secondary p-3 space-y-2">
            <label className={LABEL_CLS}>Rejection reason</label>
            <textarea className={INPUT_CLS} rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <div className="flex items-center justify-end gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={() => setRejectOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={busy || !rejectReason.trim()}
                onClick={() => run(() => talentApi.rejectPromotion(id, rejectReason.trim()))}
              >
                Reject promotion
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
