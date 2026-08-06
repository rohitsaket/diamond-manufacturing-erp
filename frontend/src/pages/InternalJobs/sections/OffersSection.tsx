import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Download, FileText, Info, Plus } from 'lucide-react';
import { internalHiringApi, internalJobsApi } from '../../../api/internalJobs';
import { openAuthenticatedFile } from '../../../api/payroll';
import { orgApi } from '../../../api/organization';
import { ApiError } from '../../../api/client';
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
import { TabBar } from '../../../components/common/TabBar';
import { useAuth, isStaffRole } from '../../../contexts/AuthContext';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const OFFER_STATUSES = [
  'ALL',
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'RELEASED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'WITHDRAWN',
  'EFFECTED',
];

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'default',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  RELEASED: 'primary',
  ACCEPTED: 'success',
  DECLINED: 'danger',
  EXPIRED: 'default',
  WITHDRAWN: 'default',
  EFFECTED: 'success',
};

const TYPE_LABEL: Record<string, string> = {
  INTERNAL_TRANSFER: 'Transfer',
  PROMOTION: 'Promotion',
  SALARY_REVISION: 'Salary',
  GIG_ASSIGNMENT: 'Gig',
};

const TYPE_TONE: Record<string, Tone> = {
  INTERNAL_TRANSFER: 'info',
  PROMOTION: 'success',
  SALARY_REVISION: 'warning',
  GIG_ASSIGNMENT: 'primary',
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

function typeChip(offerType: unknown) {
  const key = String(offerType ?? '');
  return <Chip label={TYPE_LABEL[key] ?? text(offerType)} tone={TYPE_TONE[key] ?? 'default'} />;
}

function downloadLetter(offer: any) {
  openAuthenticatedFile(
    internalHiringApi.offerLetterUrl(Number(offer.id)),
    `${String(offer.offerCode ?? 'offer')}-letter.pdf`,
  ).catch((err) => window.alert(reason(err)));
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function OffersSection() {
  const { user } = useAuth();
  const staff = isStaffRole(user?.role);
  const [tab, setTab] = useState(staff ? 'all' : 'mine');

  const tabs = staff
    ? [
        { id: 'all', label: 'All Offers' },
        { id: 'mine', label: 'My Offers' },
      ]
    : [{ id: 'mine', label: 'My Offers' }];

  return (
    <div className="space-y-4">
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'all' && staff && <AllOffersTab />}
      {tab === 'mine' && <MyOffersTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff: all offers
// ---------------------------------------------------------------------------

function AllOffersTab() {
  const [status, setStatus] = useState('ALL');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    internalHiringApi
      .offers(status === 'ALL' ? {} : { status })
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {OFFER_STATUSES.map((s) => (
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
        <button type="button" className={BTN_PRIMARY} onClick={() => setCreateOpen(true)}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} /> New offer
          </span>
        </button>
      </div>

      {loading && <LoadingBlock label="Loading offers…" />}
      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <EmptyBlock message="No offers for this filter" hint="Offers are created from applications in INTERVIEW or SELECTED." />
      )}

      {!loading && rows.length > 0 && (
        <TableShell
          headers={['Offer', 'Employee', 'Job', 'Type', 'To grade / dept', 'Effective', 'Valid until', 'Letter', 'Status']}
        >
          {rows.map((o) => (
            <tr
              key={o.id}
              className="hover:bg-bg-hover transition-colors cursor-pointer"
              onClick={() => setDetailId(Number(o.id))}
            >
              <td className="px-3 py-2 text-xs text-text-primary font-mono whitespace-nowrap">{text(o.offerCode)}</td>
              <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(o.employeeName)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(o.jobTitle)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{typeChip(o.offerType)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                {o.toGrade ? `Grade ${o.toGrade}` : text(o.toDepartmentName)}
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{fmtDate(o.effectiveDate)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{fmtDate(o.validUntil)}</td>
              <td className="px-3 py-2 text-xs text-text-muted font-mono whitespace-nowrap">{text(o.letterNumber)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={String(o.status ?? '—').replace(/_/g, ' ')} tone={STATUS_TONE[o.status] ?? 'default'} dot />
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {createOpen && (
          <CreateOfferModal
            onClose={() => setCreateOpen(false)}
            onSaved={() => {
              setCreateOpen(false);
              load();
            }}
          />
        )}
        {detailId !== null && <OfferDetailModal offerId={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create offer
// ---------------------------------------------------------------------------

function CreateOfferModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [applications, setApplications] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);

  const [applicationId, setApplicationId] = useState('');
  const [offerType, setOfferType] = useState('INTERNAL_TRANSFER');
  const [title, setTitle] = useState('');
  const [toDepartmentId, setToDepartmentId] = useState('');
  const [toGrade, setToGrade] = useState('');
  const [salaryRevisionPct, setSalaryRevisionPct] = useState('');
  const [salaryRevisionAmount, setSalaryRevisionAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [terms, setTerms] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Offers can only be raised for applications already in INTERVIEW/SELECTED.
    internalJobsApi
      .applications()
      .then((list) =>
        setApplications(
          (Array.isArray(list) ? list : []).filter((a) => ['INTERVIEW', 'SELECTED'].includes(String(a?.status))),
        ),
      )
      .catch(() => setApplications([]));
    orgApi.departments
      .list()
      .then((list: any) => setDepartments(Array.isArray(list) ? list : []))
      .catch(() => setDepartments([]));
  }, []);

  const selectedApp = applications.find((a) => String(a.id) === applicationId);

  const save = () => {
    setBusy(true);
    setError(null);
    internalHiringApi
      .createOffer({
        applicationId: Number(applicationId),
        offerType,
        title: title.trim(),
        toDepartmentId: offerType === 'INTERNAL_TRANSFER' && toDepartmentId ? Number(toDepartmentId) : undefined,
        toGrade: offerType === 'PROMOTION' && toGrade.trim() ? toGrade.trim() : undefined,
        salaryRevisionPct:
          offerType === 'SALARY_REVISION' && salaryRevisionPct !== '' ? Number(salaryRevisionPct) : undefined,
        salaryRevisionAmount:
          offerType === 'SALARY_REVISION' && salaryRevisionAmount !== '' ? Number(salaryRevisionAmount) : undefined,
        effectiveDate: effectiveDate || undefined,
        validUntil: validUntil || undefined,
        terms: terms.trim() || undefined,
      })
      .then(() => onSaved())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title="New offer"
      subtitle="Created as a DRAFT — submit it for approval afterwards."
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !applicationId || !title.trim()} onClick={save}>
            {busy ? 'Creating…' : 'Create offer'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}

        <div>
          <label className={LABEL_CLS}>Application (INTERVIEW / SELECTED only)</label>
          <select className={INPUT_CLS} value={applicationId} onChange={(e) => setApplicationId(e.target.value)}>
            <option value="">Select…</option>
            {applications.map((a) => (
              <option key={a.id} value={a.id}>
                #{a.id} · {a.employeeName} ({a.empCode}) — {a.jobTitle} [{a.status}]
              </option>
            ))}
          </select>
          {applications.length === 0 && (
            <p className="text-text-muted text-[11px] mt-1">
              No applications are currently in INTERVIEW or SELECTED — move one forward first.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Offer type</label>
            <select className={INPUT_CLS} value={offerType} onChange={(e) => setOfferType(e.target.value)}>
              <option value="INTERNAL_TRANSFER">Internal transfer</option>
              <option value="PROMOTION">Promotion</option>
              <option value="SALARY_REVISION">Salary revision</option>
              <option value="GIG_ASSIGNMENT">Gig assignment</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Title</label>
            <input className={INPUT_CLS} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>

        {offerType === 'INTERNAL_TRANSFER' && (
          <div>
            <label className={LABEL_CLS}>Destination department</label>
            <select className={INPUT_CLS} value={toDepartmentId} onChange={(e) => setToDepartmentId(e.target.value)}>
              <option value="">Select…</option>
              {departments.map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.name ?? d.code ?? `Department #${d.id}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {offerType === 'PROMOTION' && (
          <div>
            <label className={LABEL_CLS}>
              Promote to grade{selectedApp?.grade ? ` (currently ${selectedApp.grade})` : ''}
            </label>
            <input className={INPUT_CLS} value={toGrade} onChange={(e) => setToGrade(e.target.value)} placeholder="e.g. A+++" />
          </div>
        )}

        {offerType === 'SALARY_REVISION' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Revision %</label>
                <input
                  type="number"
                  className={INPUT_CLS}
                  value={salaryRevisionPct}
                  onChange={(e) => setSalaryRevisionPct(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Revision amount (₹/month)</label>
                <input
                  type="number"
                  className={INPUT_CLS}
                  value={salaryRevisionAmount}
                  onChange={(e) => setSalaryRevisionAmount(e.target.value)}
                />
              </div>
            </div>
            <p className="text-text-muted text-[11px]">
              These figures are recorded as a recommendation — the actual revision is applied in Payroll →
              Compensation, not by effecting this offer.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Effective date</label>
            <input type="date" className={INPUT_CLS} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Valid until</label>
            <input type="date" className={INPUT_CLS} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>

        {offerType === 'GIG_ASSIGNMENT' && (
          <div>
            <label className={LABEL_CLS}>Gig terms</label>
            <textarea
              className={INPUT_CLS}
              rows={2}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="Duration, hours per day, reporting…"
            />
          </div>
        )}
        {offerType !== 'GIG_ASSIGNMENT' && (
          <div>
            <label className={LABEL_CLS}>Terms (optional)</label>
            <textarea className={INPUT_CLS} rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Detail + lifecycle
// ---------------------------------------------------------------------------

function OfferDetailModal({
  offerId,
  onClose,
  onChanged,
}: {
  offerId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [offer, setOffer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [releaseNote, setReleaseNote] = useState<string | null>(null);
  const [effectResult, setEffectResult] = useState<any>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    internalHiringApi
      .offer(offerId)
      .then((o) => setOffer(o ?? null))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [offerId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = (fn: () => Promise<any>, after?: (res: any) => void) => {
    setBusy(true);
    setActionError(null);
    fn()
      .then((res) => {
        after?.(res);
        load();
        onChanged();
      })
      .catch((err) => setActionError(reason(err)))
      .finally(() => setBusy(false));
  };

  const status = String(offer?.status ?? '');
  const canLetter = ['APPROVED', 'RELEASED', 'ACCEPTED', 'EFFECTED'].includes(status);

  const effect = () => {
    const ok = window.confirm(
      'Effect this offer?\n\nThis makes a LIVE change to the employee record (department/grade per the offer type), ' +
        'pays any linked referral its reward points, and checks whether the job is now fully filled. ' +
        'Salary revisions are recorded as recommendations only.',
    );
    if (ok) run(() => internalHiringApi.effectOffer(offerId), (res) => setEffectResult(res ?? null));
  };

  return (
    <ModalShell
      title={offer ? `Offer — ${text(offer.offerCode)}` : 'Offer'}
      subtitle={offer ? `${text(offer.employeeName)} · ${text(offer.jobTitle)}` : null}
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      {loading ? (
        <LoadingBlock label="Loading the offer…" />
      ) : error ? (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      ) : offer ? (
        <div className="space-y-4">
          {actionError && <ErrorBlock message={actionError} />}

          <div className="flex items-center gap-2 flex-wrap">
            <Chip label={status.replace(/_/g, ' ')} tone={STATUS_TONE[status] ?? 'default'} dot />
            {typeChip(offer.offerType)}
            {offer.letterNumber && <Chip label={`Letter ${offer.letterNumber}`} tone="default" />}
          </div>

          {releaseNote && (
            <div className="rounded-md bg-info-light border border-info/30 px-3 py-2 flex items-start gap-2">
              <Info size={14} className="text-info flex-shrink-0 mt-0.5" />
              <p className="text-text-secondary text-xs">{releaseNote}</p>
            </div>
          )}

          {effectResult && (
            <div className="rounded-md bg-success-light border border-success/30 px-3 py-2 space-y-1">
              <p className="text-success text-xs font-semibold">Offer effected — the employee record has been updated.</p>
              <p className="text-text-secondary text-xs">
                Job filled: {effectResult.jobFilled ? 'yes — all openings are now taken' : 'not yet'} · Referral reward:{' '}
                {effectResult.referralRewarded ? 'paid to the referrer' : 'none linked'}
              </p>
              {effectResult.note && <p className="text-text-muted text-xs">{String(effectResult.note)}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-xs">
            <div>
              <p className={LABEL_CLS}>Title</p>
              <p className="text-text-secondary">{text(offer.title)}</p>
            </div>
            <div>
              <p className={LABEL_CLS}>To department</p>
              <p className="text-text-secondary">{text(offer.toDepartmentName)}</p>
            </div>
            <div>
              <p className={LABEL_CLS}>To grade</p>
              <p className="text-text-secondary">{text(offer.toGrade)}</p>
            </div>
            <div>
              <p className={LABEL_CLS}>Salary revision</p>
              <p className="text-text-secondary">
                {offer.salaryRevisionPct !== null && offer.salaryRevisionPct !== undefined
                  ? `${offer.salaryRevisionPct}%`
                  : offer.salaryRevisionAmount !== null && offer.salaryRevisionAmount !== undefined
                    ? `₹${offer.salaryRevisionAmount}`
                    : '—'}
              </p>
            </div>
            <div>
              <p className={LABEL_CLS}>Effective</p>
              <p className="text-text-secondary">{fmtDate(offer.effectiveDate)}</p>
            </div>
            <div>
              <p className={LABEL_CLS}>Valid until</p>
              <p className="text-text-secondary">{fmtDate(offer.validUntil)}</p>
            </div>
            <div>
              <p className={LABEL_CLS}>Released</p>
              <p className="text-text-secondary">{fmtDate(offer.releasedAt)}</p>
            </div>
            <div>
              <p className={LABEL_CLS}>Responded</p>
              <p className="text-text-secondary">{fmtDate(offer.respondedAt)}</p>
            </div>
            <div>
              <p className={LABEL_CLS}>Effected</p>
              <p className="text-text-secondary">{fmtDate(offer.effectedAt)}</p>
            </div>
          </div>

          {offer.terms && (
            <div>
              <p className={LABEL_CLS}>Terms</p>
              <p className="text-text-secondary text-xs whitespace-pre-wrap">{String(offer.terms)}</p>
            </div>
          )}
          {offer.responseNote && (
            <div>
              <p className={LABEL_CLS}>Employee response note</p>
              <p className="text-text-secondary text-xs">{String(offer.responseNote)}</p>
            </div>
          )}

          {/* Lifecycle actions ------------------------------------------- */}
          <div className="rounded-md border border-border-default p-3 space-y-3">
            <p className={LABEL_CLS}>Lifecycle</p>
            <div className="flex items-center gap-2 flex-wrap">
              {status === 'DRAFT' && (
                <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => run(() => internalHiringApi.submitOffer(offerId))}>
                  Submit for approval
                </button>
              )}
              {status === 'PENDING_APPROVAL' && (
                <>
                  <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => run(() => internalHiringApi.approveOffer(offerId))}>
                    Approve
                  </button>
                  <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => setRejecting((v) => !v)}>
                    Reject approval
                  </button>
                </>
              )}
              {status === 'APPROVED' && (
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => internalHiringApi.releaseOffer(offerId),
                      (res) => setReleaseNote(res?.note ? String(res.note) : null),
                    )
                  }
                >
                  Release to employee
                </button>
              )}
              {status === 'ACCEPTED' && (
                <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={effect}>
                  Effect offer
                </button>
              )}
              {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RELEASED'].includes(status) && (
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Withdraw this offer?')) run(() => internalHiringApi.withdrawOffer(offerId));
                  }}
                >
                  Withdraw
                </button>
              )}
              {canLetter && (
                <>
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    disabled={busy}
                    onClick={() => run(() => internalHiringApi.issueOfferLetter(offerId))}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <FileText size={14} /> {offer.letterNumber ? 'Re-issue letter' : 'Issue letter'}
                    </span>
                  </button>
                  {offer.letterNumber && (
                    <button type="button" className={BTN_SECONDARY} onClick={() => downloadLetter(offer)}>
                      <span className="inline-flex items-center gap-1.5">
                        <Download size={14} /> Letter PDF
                      </span>
                    </button>
                  )}
                </>
              )}
            </div>

            {rejecting && status === 'PENDING_APPROVAL' && (
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-48">
                  <label className={LABEL_CLS}>Rejection reason (required)</label>
                  <input className={INPUT_CLS} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                </div>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={busy || !rejectReason.trim()}
                  onClick={() =>
                    run(() => internalHiringApi.rejectOfferApproval(offerId, rejectReason.trim()), () => setRejecting(false))
                  }
                >
                  Confirm reject
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// ESS: my offers
// ---------------------------------------------------------------------------

function MyOffersTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [declining, setDeclining] = useState<number | null>(null);
  const [declineNote, setDeclineNote] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    internalHiringApi
      .myOffers()
      .then((list) => {
        setRows(Array.isArray(list) ? list : []);
        setBlocked(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 400) setBlocked(reason(err));
        else setError(reason(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accept = (id: number) => {
    setBusy(true);
    internalHiringApi
      .acceptOffer(id)
      .then((res) => {
        if (res?.note) setNotes((prev) => ({ ...prev, [id]: String(res.note) }));
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const decline = (id: number) => {
    setBusy(true);
    internalHiringApi
      .declineOffer(id, declineNote.trim() || undefined)
      .then(() => {
        setDeclining(null);
        setDeclineNote('');
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  if (loading) return <LoadingBlock label="Loading your offers…" />;

  if (blocked)
    return (
      <div className="rounded-md bg-info-light border border-info/30 px-4 py-3 flex items-start gap-2">
        <Info size={16} className="text-info flex-shrink-0 mt-0.5" />
        <p className="text-text-primary text-sm">{blocked}</p>
      </div>
    );

  if (error)
    return (
      <div className="space-y-2">
        <ErrorBlock message={error} />
        <button type="button" className={BTN_SECONDARY} onClick={load}>
          Retry
        </button>
      </div>
    );

  if (rows.length === 0)
    return <EmptyBlock message="No offers for you yet" hint="Offers appear here once HR releases them to you." />;

  return (
    <div className="space-y-3">
      {rows.map((o) => {
        const status = String(o?.status ?? '');
        const letterReady = !!o?.letterNumber || !!o?.letterGeneratedAt;
        return (
          <div key={o.id} className="bg-bg-card border border-border-default rounded-md p-4 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-text-primary text-sm font-semibold">{text(o.title)}</p>
                <p className="text-text-muted text-[11px] font-mono">{text(o.offerCode)} · {text(o.jobTitle)}</p>
              </div>
              <div className="flex items-center gap-2">
                {typeChip(o.offerType)}
                <Chip label={status.replace(/_/g, ' ')} tone={STATUS_TONE[status] ?? 'default'} dot />
              </div>
            </div>

            <div className="flex items-center gap-4 text-[11px] text-text-muted flex-wrap">
              <span>Effective {fmtDate(o.effectiveDate)}</span>
              <span>Respond by {fmtDate(o.validUntil)}</span>
              {o.toGrade && <span>To grade {o.toGrade}</span>}
              {o.toDepartmentName && <span>To {o.toDepartmentName}</span>}
            </div>
            {o.terms && <p className="text-text-secondary text-xs">{String(o.terms)}</p>}

            {notes[Number(o.id)] && (
              <div className="rounded-md bg-info-light border border-info/30 px-3 py-2">
                <p className="text-text-secondary text-xs">{notes[Number(o.id)]}</p>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {status === 'RELEASED' && (
                <>
                  <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => accept(Number(o.id))}>
                    Accept offer
                  </button>
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    disabled={busy}
                    onClick={() => setDeclining(declining === Number(o.id) ? null : Number(o.id))}
                  >
                    Decline
                  </button>
                </>
              )}
              {letterReady && (
                <button type="button" className={BTN_SECONDARY} onClick={() => downloadLetter(o)}>
                  <span className="inline-flex items-center gap-1.5">
                    <Download size={14} /> Offer letter
                  </span>
                </button>
              )}
            </div>

            {declining === Number(o.id) && (
              <div className="flex items-end gap-2 flex-wrap rounded-md border border-border-light bg-bg-secondary p-3">
                <div className="flex-1 min-w-48">
                  <label className={LABEL_CLS}>Reason (optional)</label>
                  <input className={INPUT_CLS} value={declineNote} onChange={(e) => setDeclineNote(e.target.value)} />
                </div>
                <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => decline(Number(o.id))}>
                  {busy ? 'Declining…' : 'Confirm decline'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
