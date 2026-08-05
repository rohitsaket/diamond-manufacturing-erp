import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { CalendarDays, ChevronDown, ChevronRight, Pencil, Plus, RefreshCw } from 'lucide-react';
import { performanceApi } from '../../../api/performance';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const CYCLE_TYPES = ['ANNUAL', 'HALF_YEARLY', 'QUARTERLY', 'MONTHLY', 'PROBATION', 'PROJECT', 'CUSTOM'];

/** Legal single next step in the cycle lifecycle; backend 409s anything else. */
const NEXT_STATUS: Record<string, string> = {
  DRAFT: 'GOAL_SETTING',
  GOAL_SETTING: 'ACTIVE',
  ACTIVE: 'SELF_REVIEW',
  SELF_REVIEW: 'MANAGER_REVIEW',
  MANAGER_REVIEW: 'CALIBRATION',
  CALIBRATION: 'CLOSED',
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

function statusTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'success';
    case 'GOAL_SETTING':
      return 'info';
    case 'SELF_REVIEW':
    case 'MANAGER_REVIEW':
    case 'CALIBRATION':
      return 'warning';
    case 'CLOSED':
      return 'danger';
    case 'DRAFT':
    default:
      return 'default';
  }
}

function stageTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'OPEN':
      return 'success';
    case 'UPCOMING':
      return 'info';
    case 'CLOSED':
      return 'default';
    default:
      return 'default';
  }
}

function typeTone(cycleType: unknown): Tone {
  switch (String(cycleType ?? '').toUpperCase()) {
    case 'ANNUAL':
      return 'primary';
    case 'QUARTERLY':
      return 'info';
    case 'HALF_YEARLY':
      return 'warning';
    default:
      return 'default';
  }
}

interface CycleForm {
  code: string;
  name: string;
  cycleType: string;
  financialYear: string;
  startDate: string;
  endDate: string;
  goalSettingStart: string;
  goalSettingEnd: string;
  selfReviewStart: string;
  selfReviewEnd: string;
  managerReviewStart: string;
  managerReviewEnd: string;
  calibrationStart: string;
  calibrationEnd: string;
  description: string;
}

const EMPTY_FORM: CycleForm = {
  code: '',
  name: '',
  cycleType: 'ANNUAL',
  financialYear: '',
  startDate: '',
  endDate: '',
  goalSettingStart: '',
  goalSettingEnd: '',
  selfReviewStart: '',
  selfReviewEnd: '',
  managerReviewStart: '',
  managerReviewEnd: '',
  calibrationStart: '',
  calibrationEnd: '',
  description: '',
};

/** ISO date (YYYY-MM-DD) from whatever the API stored. */
function dateInput(value: unknown): string {
  if (!value) return '';
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

// ---------------------------------------------------------------------------

export function CyclesSection() {
  const [cycles, setCycles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-cycle expanded review calendar.
  const [openCalendar, setOpenCalendar] = useState<number | null>(null);
  const [calendar, setCalendar] = useState<any>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  // Create/edit modal.
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<CycleForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [advancing, setAdvancing] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    performanceApi
      .cycles()
      .then((rows) => setCycles(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleCalendar = useCallback((id: number) => {
    setOpenCalendar((prev) => {
      const next = prev === id ? null : id;
      if (next !== null) {
        setCalendar(null);
        setCalendarError(null);
        setCalendarLoading(true);
        performanceApi
          .cycleCalendar(id)
          .then((res) => setCalendar(res ?? null))
          .catch((err) => setCalendarError(reason(err)))
          .finally(() => setCalendarLoading(false));
      }
      return next;
    });
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalError(null);
    setModalOpen(true);
  };

  const openEdit = (cycle: any) => {
    setEditing(cycle);
    setForm({
      code: String(cycle?.code ?? ''),
      name: String(cycle?.name ?? ''),
      cycleType: String(cycle?.cycleType ?? 'ANNUAL'),
      financialYear: String(cycle?.financialYear ?? ''),
      startDate: dateInput(cycle?.startDate),
      endDate: dateInput(cycle?.endDate),
      goalSettingStart: dateInput(cycle?.goalSettingStart),
      goalSettingEnd: dateInput(cycle?.goalSettingEnd),
      selfReviewStart: dateInput(cycle?.selfReviewStart),
      selfReviewEnd: dateInput(cycle?.selfReviewEnd),
      managerReviewStart: dateInput(cycle?.managerReviewStart),
      managerReviewEnd: dateInput(cycle?.managerReviewEnd),
      calibrationStart: dateInput(cycle?.calibrationStart),
      calibrationEnd: dateInput(cycle?.calibrationEnd),
      description: String(cycle?.description ?? ''),
    });
    setModalError(null);
    setModalOpen(true);
  };

  const save = () => {
    setSaving(true);
    setModalError(null);
    const body: Record<string, unknown> = {
      code: form.code.trim(),
      name: form.name.trim(),
      cycleType: form.cycleType,
      financialYear: form.financialYear.trim() || null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      goalSettingStart: form.goalSettingStart || null,
      goalSettingEnd: form.goalSettingEnd || null,
      selfReviewStart: form.selfReviewStart || null,
      selfReviewEnd: form.selfReviewEnd || null,
      managerReviewStart: form.managerReviewStart || null,
      managerReviewEnd: form.managerReviewEnd || null,
      calibrationStart: form.calibrationStart || null,
      calibrationEnd: form.calibrationEnd || null,
      description: form.description.trim() || null,
    };
    const call = editing
      ? performanceApi.updateCycle(Number(editing.id), body)
      : performanceApi.createCycle(body);
    call
      .then(() => {
        setModalOpen(false);
        load();
      })
      .catch((err) => setModalError(reason(err)))
      .finally(() => setSaving(false));
  };

  const advance = (cycle: any) => {
    const next = NEXT_STATUS[String(cycle?.status ?? '')];
    if (!next) return;
    if (!window.confirm(`Move cycle ${cycle.code} from ${cycle.status} to ${next}?`)) return;
    setAdvancing(Number(cycle.id));
    performanceApi
      .setCycleStatus(Number(cycle.id), next)
      .then(() => load())
      // A 409 here is the backend refusing an illegal stage jump — show it verbatim.
      .catch((err) => window.alert(reason(err)))
      .finally(() => setAdvancing(null));
  };

  const dateField = (key: keyof CycleForm, label: string) => (
    <div>
      <label className={LABEL_CLS} htmlFor={`cyc-${key}`}>
        {label}
      </label>
      <input
        id={`cyc-${key}`}
        type="date"
        className={INPUT_CLS}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  if (firstLoad && loading) return <LoadingBlock label="Loading performance cycles…" />;

  return (
    <div className="space-y-4">
      {/* Controls ---------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-text-muted text-xs">
          Lifecycle: DRAFT → GOAL_SETTING → ACTIVE → SELF_REVIEW → MANAGER_REVIEW → CALIBRATION → CLOSED. Only the
          next legal stage can be advanced to.
        </p>
        <div className="flex items-center gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              Refresh
            </span>
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={openCreate}>
            <span className="inline-flex items-center gap-2">
              <Plus size={14} />
              New cycle
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {/* Cycle cards ------------------------------------------------------- */}
      {cycles.length === 0 && !error ? (
        <EmptyBlock message="No performance cycles yet" hint="Create the first cycle to start setting goals." />
      ) : (
        <div className="space-y-3">
          {cycles.map((c) => {
            const next = NEXT_STATUS[String(c?.status ?? '')];
            const expanded = openCalendar === Number(c?.id);
            return (
              <div key={c?.id} className="bg-bg-card border border-border-default rounded-md">
                <div className="p-4 flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-text-primary text-sm font-semibold">{text(c?.name)}</p>
                      <span className="text-text-muted text-xs font-mono">{text(c?.code)}</span>
                      <Chip label={text(c?.cycleType)} tone={typeTone(c?.cycleType)} />
                      <Chip label={text(c?.status)} tone={statusTone(c?.status)} dot />
                    </div>
                    <p className="text-text-muted text-xs mt-1">
                      {text(c?.financialYear)} · {fmtDate(c?.startDate)} — {fmtDate(c?.endDate)}
                    </p>
                    {c?.description && <p className="text-text-secondary text-xs mt-1">{String(c.description)}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      className={BTN_SECONDARY}
                      onClick={() => toggleCalendar(Number(c.id))}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <CalendarDays size={14} />
                        Review calendar
                      </span>
                    </button>
                    <button type="button" className={BTN_SECONDARY} onClick={() => openEdit(c)}>
                      <span className="inline-flex items-center gap-1.5">
                        <Pencil size={14} />
                        Edit
                      </span>
                    </button>
                    {next && (
                      <button
                        type="button"
                        className={BTN_PRIMARY}
                        onClick={() => advance(c)}
                        disabled={advancing === Number(c.id)}
                      >
                        {advancing === Number(c.id) ? 'Advancing…' : `Advance to ${next.replace(/_/g, ' ')}`}
                      </button>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-border-default px-4 py-3 bg-bg-secondary rounded-b-md">
                    {calendarLoading && <LoadingBlock label="Loading calendar…" />}
                    {calendarError && <ErrorBlock message={calendarError} />}
                    {!calendarLoading && !calendarError && calendar && (
                      <div className="space-y-2">
                        {calendar?.today && (
                          <p className="text-text-muted text-[11px]">As of {fmtDate(calendar.today)}</p>
                        )}
                        {(Array.isArray(calendar?.stages) ? calendar.stages : []).map(
                          (s: any, index: number) => (
                            <div
                              key={s?.stage ?? index}
                              className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-bg-card border border-border-light"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-text-primary text-xs font-medium">
                                  {text(s?.stage).replace(/_/g, ' ')}
                                </span>
                                <Chip label={text(s?.status)} tone={stageTone(s?.status)} dot />
                              </div>
                              <span className="text-text-muted text-[11px] flex-shrink-0">
                                {fmtDate(s?.start)} — {fmtDate(s?.end)}
                              </span>
                            </div>
                          ),
                        )}
                        {(!Array.isArray(calendar?.stages) || calendar.stages.length === 0) && (
                          <p className="text-text-muted text-xs italic">
                            No stage windows are configured on this cycle.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create / edit modal ------------------------------------------------ */}
      <AnimatePresence>
        {modalOpen && (
          <ModalShell
            title={editing ? `Edit cycle ${editing.code}` : 'New performance cycle'}
            subtitle="Stage windows are optional — the review calendar only lists the ones you set."
            onClose={() => setModalOpen(false)}
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create cycle'}
                </button>
              </div>
            }
          >
            <div className="space-y-4">
              {modalError && <ErrorBlock message={modalError} />}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS} htmlFor="cyc-code">
                    Code
                  </label>
                  <input
                    id="cyc-code"
                    className={INPUT_CLS}
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    placeholder="PERF-FY27"
                  />
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="cyc-name">
                    Name
                  </label>
                  <input
                    id="cyc-name"
                    className={INPUT_CLS}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Annual Cycle FY 2027-28"
                  />
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="cyc-type">
                    Cycle type
                  </label>
                  <select
                    id="cyc-type"
                    className={INPUT_CLS}
                    value={form.cycleType}
                    onChange={(e) => setForm((f) => ({ ...f, cycleType: e.target.value }))}
                  >
                    {CYCLE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="cyc-fy">
                    Financial year
                  </label>
                  <input
                    id="cyc-fy"
                    className={INPUT_CLS}
                    value={form.financialYear}
                    onChange={(e) => setForm((f) => ({ ...f, financialYear: e.target.value }))}
                    placeholder="2027-2028"
                  />
                </div>
                {dateField('startDate', 'Start date')}
                {dateField('endDate', 'End date')}
              </div>

              <div>
                <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold mb-2">
                  Stage windows (optional)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {dateField('goalSettingStart', 'Goal setting start')}
                  {dateField('goalSettingEnd', 'Goal setting end')}
                  {dateField('selfReviewStart', 'Self review start')}
                  {dateField('selfReviewEnd', 'Self review end')}
                  {dateField('managerReviewStart', 'Manager review start')}
                  {dateField('managerReviewEnd', 'Manager review end')}
                  {dateField('calibrationStart', 'Calibration start')}
                  {dateField('calibrationEnd', 'Calibration end')}
                </div>
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="cyc-desc">
                  Description
                </label>
                <textarea
                  id="cyc-desc"
                  className={`${INPUT_CLS} min-h-[70px]`}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
