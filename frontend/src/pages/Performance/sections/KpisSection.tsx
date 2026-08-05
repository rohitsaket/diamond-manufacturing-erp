import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Calculator, Plus, RefreshCw } from 'lucide-react';
import { performanceApi } from '../../../api/performance';
import { api } from '../../../api/client';
import { orgApi } from '../../../api/organization';
import { useApp } from '../../../contexts/AppContext';
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

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const SCOPES = ['ALL', 'ORGANIZATION', 'DEPARTMENT', 'TEAM', 'INDIVIDUAL'] as const;
const CATEGORIES = ['PRODUCTION', 'QUALITY', 'ATTENDANCE', 'FINANCE', 'PEOPLE', 'CUSTOM'] as const;
const DIRECTIONS = ['HIGHER_BETTER', 'LOWER_BETTER', 'TARGET_BAND'] as const;
const AUTO_SOURCES = ['NONE', 'PRODUCTION_PIECES', 'PRODUCTION_VALUE', 'ATTENDANCE_PCT', 'OT_HOURS'] as const;

const AUTO_SOURCE_LABEL: Record<string, string> = {
  PRODUCTION_PIECES: 'auto: production pieces',
  PRODUCTION_VALUE: 'auto: production value',
  ATTENDANCE_PCT: 'auto: attendance %',
  OT_HOURS: 'auto: OT hours',
  NONE: 'manual',
};

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function fmtDateTime(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtNum(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function categoryTone(category: unknown): Tone {
  switch (String(category ?? '').toUpperCase()) {
    case 'PRODUCTION':
      return 'primary';
    case 'QUALITY':
      return 'success';
    case 'ATTENDANCE':
      return 'info';
    case 'FINANCE':
      return 'warning';
    default:
      return 'default';
  }
}

function ownerLabel(a: any): string {
  if (a?.employeeName) return String(a.employeeName);
  if (a?.teamName) return `Team: ${a.teamName}`;
  if (a?.departmentName) return `Dept: ${a.departmentName}`;
  return 'Organization';
}

/** Achievement bar; the fill is capped at 200% so an outlier cannot flatten the rest. */
function AchievementBar({ pct }: { pct: number | null }) {
  const capped = pct === null ? 0 : Math.max(0, Math.min(200, pct));
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="h-1.5 flex-1 rounded-full bg-bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full ${
            capped >= 100 ? 'bg-success' : capped >= 60 ? 'bg-primary' : 'bg-warning'
          }`}
          style={{ width: `${(capped / 200) * 100}%` }}
        />
      </div>
      <span className="text-text-secondary text-[11px] font-mono tabular-nums w-14 text-right">
        {pct === null ? '—' : `${pct.toFixed(1)}%`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function KpisSection() {
  const { employees } = useApp();

  const [tab, setTab] = useState('assignments');

  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [scope, setScope] = useState('ALL');

  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [computing, setComputing] = useState(false);
  const [computeResult, setComputeResult] = useState<any>(null);

  const [kpiList, setKpiList] = useState<any[]>([]);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiError, setKpiError] = useState<string | null>(null);

  // Assignment detail.
  const [detail, setDetail] = useState<any>(null);
  const [values, setValues] = useState<any[]>([]);
  const [valuesLoading, setValuesLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [valPeriod, setValPeriod] = useState('');
  const [valAmount, setValAmount] = useState('');
  const [valNote, setValNote] = useState('');
  const [recording, setRecording] = useState(false);

  // Create assignment modal.
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);
  const [aForm, setAForm] = useState({
    kpiId: '',
    scope: 'INDIVIDUAL',
    employeeId: '',
    teamId: '',
    departmentId: '',
    targetValue: '',
    thresholdValue: '',
    stretchValue: '',
    weightagePct: '',
  });

  // KPI library create/edit modal.
  const [kpiModalOpen, setKpiModalOpen] = useState(false);
  const [kpiEditing, setKpiEditing] = useState<any>(null);
  const [kpiModalError, setKpiModalError] = useState<string | null>(null);
  const [kpiSaving, setKpiSaving] = useState(false);
  const [kForm, setKForm] = useState({
    code: '',
    name: '',
    description: '',
    category: 'CUSTOM',
    unit: '',
    direction: 'HIGHER_BETTER',
    formula: '',
    autoSource: 'NONE',
    isActive: true,
  });

  useEffect(() => {
    performanceApi
      .cycles()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setCycles(list);
        const active = list.find((c) => String(c?.status) === 'ACTIVE') ?? list[0];
        setCycleId(active ? Number(active.id) : null);
        if (!active) {
          setLoading(false);
          setFirstLoad(false);
        }
      })
      .catch((err) => {
        setError(reason(err));
        setLoading(false);
        setFirstLoad(false);
      });
    orgApi.departments.list().then((d) => setDepartments(Array.isArray(d) ? d : [])).catch(() => {});
    orgApi.teams.list().then((t) => setTeams(Array.isArray(t) ? t : [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (cycleId === null) return;
    setLoading(true);
    setError(null);
    performanceApi
      .kpiAssignments({ cycleId, scope: scope === 'ALL' ? undefined : scope })
      .then((rows) => setAssignments(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [cycleId, scope]);

  useEffect(() => {
    load();
  }, [load]);

  const loadLibrary = useCallback(() => {
    setKpiLoading(true);
    setKpiError(null);
    performanceApi
      .kpis()
      .then((rows) => setKpiList(Array.isArray(rows) ? rows : []))
      .catch((err) => setKpiError(reason(err)))
      .finally(() => setKpiLoading(false));
  }, []);

  useEffect(() => {
    // The assignment modal needs the library too, so load it on either tab.
    loadLibrary();
  }, [loadLibrary]);

  const compute = () => {
    if (cycleId === null) return;
    setComputing(true);
    setComputeResult(null);
    performanceApi
      .computeKpis({ cycleId })
      .then((res) => {
        setComputeResult(res ?? null);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setComputing(false));
  };

  const openDetail = (a: any) => {
    setDetail(a);
    setDetailError(null);
    setValues([]);
    setValPeriod('');
    setValAmount('');
    setValNote('');
    setValuesLoading(true);
    // The values endpoint exists on the backend but is not wrapped in the
    // read-only api contract file, so it is called through the shared client.
    api
      .get<any[]>(`/performance/kpi-assignments/${Number(a.id)}/values`)
      .then((rows) => setValues(Array.isArray(rows) ? rows : []))
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setValuesLoading(false));
  };

  const recordValue = () => {
    if (!detail) return;
    setRecording(true);
    setDetailError(null);
    performanceApi
      .recordKpiValue(Number(detail.id), {
        periodKey: valPeriod,
        value: Number(valAmount),
        note: valNote.trim() || undefined,
      })
      .then(() => {
        load();
        openDetail(detail);
      })
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setRecording(false));
  };

  const saveAssignment = () => {
    setAssignSaving(true);
    setAssignError(null);
    performanceApi
      .createKpiAssignment({
        kpiId: aForm.kpiId === '' ? undefined : Number(aForm.kpiId),
        cycleId,
        scope: aForm.scope,
        employeeId: aForm.scope === 'INDIVIDUAL' && aForm.employeeId !== '' ? Number(aForm.employeeId) : undefined,
        teamId: aForm.scope === 'TEAM' && aForm.teamId !== '' ? Number(aForm.teamId) : undefined,
        departmentId:
          aForm.scope === 'DEPARTMENT' && aForm.departmentId !== '' ? Number(aForm.departmentId) : undefined,
        targetValue: aForm.targetValue === '' ? undefined : Number(aForm.targetValue),
        thresholdValue: aForm.thresholdValue === '' ? undefined : Number(aForm.thresholdValue),
        stretchValue: aForm.stretchValue === '' ? undefined : Number(aForm.stretchValue),
        weightagePct: aForm.weightagePct === '' ? undefined : Number(aForm.weightagePct),
      })
      .then(() => {
        setAssignOpen(false);
        load();
      })
      .catch((err) => setAssignError(reason(err)))
      .finally(() => setAssignSaving(false));
  };

  const openKpiModal = (kpi: any | null) => {
    setKpiEditing(kpi);
    setKpiModalError(null);
    setKForm({
      code: String(kpi?.code ?? ''),
      name: String(kpi?.name ?? ''),
      description: String(kpi?.description ?? ''),
      category: String(kpi?.category ?? 'CUSTOM'),
      unit: String(kpi?.unit ?? ''),
      direction: String(kpi?.direction ?? 'HIGHER_BETTER'),
      formula: String(kpi?.formula ?? ''),
      autoSource: String(kpi?.autoSource ?? 'NONE'),
      isActive: kpi ? Boolean(kpi.isActive) : true,
    });
    setKpiModalOpen(true);
  };

  const saveKpi = () => {
    setKpiSaving(true);
    setKpiModalError(null);
    const body: Record<string, unknown> = {
      code: kForm.code.trim(),
      name: kForm.name.trim(),
      description: kForm.description.trim() || null,
      category: kForm.category,
      unit: kForm.unit.trim() || null,
      direction: kForm.direction,
      formula: kForm.formula.trim() || null,
      autoSource: kForm.autoSource,
      isActive: kForm.isActive,
    };
    const call = kpiEditing
      ? performanceApi.updateKpi(Number(kpiEditing.id), body)
      : performanceApi.createKpi(body);
    call
      .then(() => {
        setKpiModalOpen(false);
        loadLibrary();
      })
      // Invalid formula 400s surface verbatim.
      .catch((err) => setKpiModalError(reason(err)))
      .finally(() => setKpiSaving(false));
  };

  const computeSkipped: any[] = Array.isArray(computeResult?.skipped) ? computeResult.skipped : [];

  if (firstLoad && loading) return <LoadingBlock label="Loading KPI assignments…" />;

  const detailIsManual = detail && String(detail.autoSource ?? 'NONE') === 'NONE';

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: 'assignments', label: 'Assignments' },
          { id: 'library', label: 'KPI Library', count: kpiList.length || null },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* --- Assignments tab ------------------------------------------------- */}
      {tab === 'assignments' && (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div className="w-64">
              <label className={LABEL_CLS} htmlFor="kpi-cycle">
                Cycle
              </label>
              <select
                id="kpi-cycle"
                className={INPUT_CLS}
                value={cycleId ?? ''}
                onChange={(e) => setCycleId(e.target.value === '' ? null : Number(e.target.value))}
              >
                {cycles.length === 0 && <option value="">No cycles</option>}
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} ({c.status})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
                <span className="inline-flex items-center gap-2">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
                  Refresh
                </span>
              </button>
              <button
                type="button"
                className={BTN_SECONDARY}
                onClick={compute}
                disabled={computing || cycleId === null}
              >
                <span className="inline-flex items-center gap-2">
                  <Calculator size={14} />
                  {computing ? 'Computing…' : 'Compute from ERP data'}
                </span>
              </button>
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={() => {
                  setAssignError(null);
                  setAssignOpen(true);
                }}
                disabled={cycleId === null}
              >
                <span className="inline-flex items-center gap-2">
                  <Plus size={14} />
                  New assignment
                </span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {SCOPES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                  s === scope
                    ? 'bg-primary-light border-primary/30 text-primary'
                    : 'border-border-default text-text-muted hover:border-text-muted'
                }`}
              >
                {s === 'ALL' ? 'All scopes' : s}
              </button>
            ))}
          </div>

          {error && (
            <div className="space-y-2">
              <ErrorBlock message={error} />
              <button type="button" className={BTN_SECONDARY} onClick={load}>
                Retry
              </button>
            </div>
          )}

          {/* Compute result — skipped reasons are shown verbatim. -------------- */}
          {computeResult && (
            <div className="rounded-md bg-bg-card border border-border-default p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-text-primary text-sm font-medium">
                  {num(computeResult.computed) ?? 0} assignment(s) computed from ERP data ·{' '}
                  {computeSkipped.length} skipped
                </p>
                <button
                  type="button"
                  className="text-text-muted text-xs hover:text-text-primary"
                  onClick={() => setComputeResult(null)}
                >
                  Dismiss
                </button>
              </div>
              {computeSkipped.length > 0 && (
                <ul className="space-y-1 list-disc list-inside">
                  {computeSkipped.map((s: any, index: number) => (
                    <li key={index} className="text-text-secondary text-xs">
                      Assignment {text(s?.assignmentId)} — {text(s?.reason)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {assignments.length === 0 && !error ? (
            <EmptyBlock
              message="No KPI assignments for this cycle"
              hint="Assign a KPI from the library, then compute it from ERP data or record values manually."
            />
          ) : (
            <TableShell
              headers={['KPI', 'Owner', 'Target / Actual', 'Achievement', 'Score', 'Weight', 'Source', 'Last computed']}
            >
              {assignments.map((a) => (
                <tr
                  key={a?.id}
                  className="hover:bg-bg-hover transition-colors cursor-pointer"
                  onClick={() => openDetail(a)}
                >
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                    {text(a?.kpiName)}
                    <p className="text-text-muted text-[11px] font-mono">{text(a?.kpiCode)}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {ownerLabel(a)}
                    <p className="text-text-muted text-[11px]">{text(a?.scope)}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {fmtNum(a?.targetValue)} / {fmtNum(a?.actualValue)}
                    <p className="text-text-muted text-[11px]">{text(a?.unit)}</p>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <AchievementBar pct={num(a?.achievementPct)} />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-primary font-mono text-right whitespace-nowrap">
                    {fmtNum(a?.score)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {num(a?.weightagePct) ?? 0}%
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip
                      label={AUTO_SOURCE_LABEL[String(a?.autoSource ?? 'NONE')] ?? text(a?.autoSource)}
                      tone={String(a?.autoSource ?? 'NONE') === 'NONE' ? 'default' : 'info'}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">
                    {fmtDateTime(a?.lastComputedAt)}
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* --- Library tab ------------------------------------------------------ */}
      {tab === 'library' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-text-muted text-xs">
              KPIs with an auto source are computed straight from ERP data; the rest take manual monthly values.
            </p>
            <button type="button" className={BTN_PRIMARY} onClick={() => openKpiModal(null)}>
              <span className="inline-flex items-center gap-2">
                <Plus size={14} />
                New KPI
              </span>
            </button>
          </div>
          {kpiLoading && <LoadingBlock label="Loading the KPI library…" />}
          {kpiError && <ErrorBlock message={kpiError} />}
          {!kpiLoading && !kpiError && kpiList.length === 0 && <EmptyBlock message="No KPIs defined yet" />}
          {!kpiLoading && !kpiError && kpiList.length > 0 && (
            <TableShell headers={['Code', 'Name', 'Category', 'Unit', 'Direction', 'Auto source', 'Active', '']}>
              {kpiList.map((k) => (
                <tr key={k?.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-muted font-mono whitespace-nowrap">{text(k?.code)}</td>
                  <td className="px-3 py-2 text-xs text-text-primary">
                    {text(k?.name)}
                    {k?.description && <p className="text-text-muted text-[11px]">{String(k.description)}</p>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(k?.category)} tone={categoryTone(k?.category)} />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(k?.unit)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {text(k?.direction).replace(/_/g, ' ')}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip
                      label={AUTO_SOURCE_LABEL[String(k?.autoSource ?? 'NONE')] ?? text(k?.autoSource)}
                      tone={String(k?.autoSource ?? 'NONE') === 'NONE' ? 'default' : 'info'}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={k?.isActive ? 'Active' : 'Inactive'} tone={k?.isActive ? 'success' : 'default'} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      className="text-primary text-xs font-medium hover:underline"
                      onClick={() => openKpiModal(k)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* --- Assignment detail modal ------------------------------------------ */}
      <AnimatePresence>
        {detail && (
          <ModalShell
            title={String(detail.kpiName ?? 'KPI assignment')}
            subtitle={`${ownerLabel(detail)} · ${AUTO_SOURCE_LABEL[String(detail.autoSource ?? 'NONE')] ?? text(detail.autoSource)}`}
            onClose={() => setDetail(null)}
            maxWidth="max-w-xl"
          >
            <div className="space-y-4">
              {detailError && <ErrorBlock message={detailError} />}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  ['Threshold', detail.thresholdValue],
                  ['Target', detail.targetValue],
                  ['Stretch', detail.stretchValue],
                  ['Actual', detail.actualValue],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-md border border-border-light bg-bg-secondary p-2.5">
                    <p className="text-text-muted text-[10px] uppercase tracking-wider">{String(label)}</p>
                    <p className="text-text-primary text-sm font-mono">{fmtNum(value)}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <AchievementBar pct={num(detail.achievementPct)} />
                <span className="text-text-muted text-xs">
                  Score {fmtNum(detail.score)} · weight {num(detail.weightagePct) ?? 0}% · last computed{' '}
                  {fmtDateTime(detail.lastComputedAt)}
                </span>
              </div>

              <div className="space-y-2">
                <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">Recorded values</p>
                {valuesLoading && <LoadingBlock label="Loading values…" />}
                {!valuesLoading && values.length === 0 && (
                  <p className="text-text-muted text-xs italic">No period values recorded for this assignment.</p>
                )}
                {!valuesLoading && values.length > 0 && (
                  <TableShell headers={['Period', 'Value', 'Source', 'Note']}>
                    {values.map((v, index) => (
                      <tr key={v?.id ?? index}>
                        <td className="px-3 py-2 text-xs text-text-primary font-mono whitespace-nowrap">
                          {text(v?.periodKey)}
                        </td>
                        <td className="px-3 py-2 text-xs text-text-primary font-mono text-right whitespace-nowrap">
                          {fmtNum(v?.value)}
                        </td>
                        <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(v?.source)}</td>
                        <td className="px-3 py-2 text-xs text-text-muted">{text(v?.note)}</td>
                      </tr>
                    ))}
                  </TableShell>
                )}
              </div>

              {detailIsManual ? (
                <div className="rounded-md border border-border-default p-3 space-y-2">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">
                    Record a manual value
                  </p>
                  <div className="flex items-end gap-2 flex-wrap">
                    <div>
                      <label className={LABEL_CLS}>Period (month)</label>
                      <input
                        type="month"
                        className={`${INPUT_CLS} w-40`}
                        value={valPeriod}
                        onChange={(e) => setValPeriod(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Value ({text(detail.unit)})</label>
                      <input
                        type="number"
                        className={`${INPUT_CLS} w-32`}
                        value={valAmount}
                        onChange={(e) => setValAmount(e.target.value)}
                      />
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <label className={LABEL_CLS}>Note</label>
                      <input className={INPUT_CLS} value={valNote} onChange={(e) => setValNote(e.target.value)} />
                    </div>
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      onClick={recordValue}
                      disabled={recording || valPeriod === '' || valAmount === ''}
                    >
                      {recording ? 'Saving…' : 'Record'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-text-muted text-xs italic">
                  This KPI is computed automatically ({AUTO_SOURCE_LABEL[String(detail.autoSource)] ?? detail.autoSource}
                  ) — use "Compute from ERP data" instead of manual entry.
                </p>
              )}
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Create assignment modal ------------------------------------------ */}
      <AnimatePresence>
        {assignOpen && (
          <ModalShell
            title="New KPI assignment"
            subtitle={cycles.find((c) => Number(c.id) === cycleId)?.name ?? null}
            onClose={() => setAssignOpen(false)}
            maxWidth="max-w-xl"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setAssignOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={saveAssignment}
                  disabled={assignSaving || aForm.kpiId === ''}
                >
                  {assignSaving ? 'Saving…' : 'Create assignment'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {assignError && <ErrorBlock message={assignError} />}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>KPI</label>
                  <select
                    className={INPUT_CLS}
                    value={aForm.kpiId}
                    onChange={(e) => setAForm((f) => ({ ...f, kpiId: e.target.value }))}
                  >
                    <option value="">Select KPI…</option>
                    {kpiList
                      .filter((k) => k?.isActive)
                      .map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.code} — {k.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Scope</label>
                  <select
                    className={INPUT_CLS}
                    value={aForm.scope}
                    onChange={(e) => setAForm((f) => ({ ...f, scope: e.target.value }))}
                  >
                    {['INDIVIDUAL', 'TEAM', 'DEPARTMENT', 'ORGANIZATION'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                {aForm.scope === 'INDIVIDUAL' && (
                  <div>
                    <label className={LABEL_CLS}>Employee</label>
                    <select
                      className={INPUT_CLS}
                      value={aForm.employeeId}
                      onChange={(e) => setAForm((f) => ({ ...f, employeeId: e.target.value }))}
                    >
                      <option value="">Select employee…</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.fullName} ({e.empCode})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {aForm.scope === 'TEAM' && (
                  <div>
                    <label className={LABEL_CLS}>Team</label>
                    <select
                      className={INPUT_CLS}
                      value={aForm.teamId}
                      onChange={(e) => setAForm((f) => ({ ...f, teamId: e.target.value }))}
                    >
                      <option value="">Select team…</option>
                      {teams.map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {aForm.scope === 'DEPARTMENT' && (
                  <div>
                    <label className={LABEL_CLS}>Department</label>
                    <select
                      className={INPUT_CLS}
                      value={aForm.departmentId}
                      onChange={(e) => setAForm((f) => ({ ...f, departmentId: e.target.value }))}
                    >
                      <option value="">Select department…</option>
                      {departments.map((d: any) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className={LABEL_CLS}>Threshold</label>
                  <input
                    type="number"
                    className={INPUT_CLS}
                    value={aForm.thresholdValue}
                    onChange={(e) => setAForm((f) => ({ ...f, thresholdValue: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Target</label>
                  <input
                    type="number"
                    className={INPUT_CLS}
                    value={aForm.targetValue}
                    onChange={(e) => setAForm((f) => ({ ...f, targetValue: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Stretch</label>
                  <input
                    type="number"
                    className={INPUT_CLS}
                    value={aForm.stretchValue}
                    onChange={(e) => setAForm((f) => ({ ...f, stretchValue: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Weightage %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={INPUT_CLS}
                    value={aForm.weightagePct}
                    onChange={(e) => setAForm((f) => ({ ...f, weightagePct: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- KPI create/edit modal --------------------------------------------- */}
      <AnimatePresence>
        {kpiModalOpen && (
          <ModalShell
            title={kpiEditing ? `Edit KPI ${kpiEditing.code}` : 'New KPI'}
            onClose={() => setKpiModalOpen(false)}
            maxWidth="max-w-xl"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setKpiModalOpen(false)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={saveKpi} disabled={kpiSaving}>
                  {kpiSaving ? 'Saving…' : kpiEditing ? 'Save changes' : 'Create KPI'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {kpiModalError && <ErrorBlock message={kpiModalError} />}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Code</label>
                  <input
                    className={INPUT_CLS}
                    value={kForm.code}
                    onChange={(e) => setKForm((f) => ({ ...f, code: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Name</label>
                  <input
                    className={INPUT_CLS}
                    value={kForm.name}
                    onChange={(e) => setKForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Category</label>
                  <select
                    className={INPUT_CLS}
                    value={kForm.category}
                    onChange={(e) => setKForm((f) => ({ ...f, category: e.target.value }))}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Unit</label>
                  <input
                    className={INPUT_CLS}
                    value={kForm.unit}
                    onChange={(e) => setKForm((f) => ({ ...f, unit: e.target.value }))}
                    placeholder="pieces, %, INR…"
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Direction</label>
                  <select
                    className={INPUT_CLS}
                    value={kForm.direction}
                    onChange={(e) => setKForm((f) => ({ ...f, direction: e.target.value }))}
                  >
                    {DIRECTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Auto source</label>
                  <select
                    className={INPUT_CLS}
                    value={kForm.autoSource}
                    onChange={(e) => setKForm((f) => ({ ...f, autoSource: e.target.value }))}
                  >
                    {AUTO_SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {AUTO_SOURCE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Description</label>
                <textarea
                  className={`${INPUT_CLS} min-h-[60px]`}
                  value={kForm.description}
                  onChange={(e) => setKForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Formula (optional)</label>
                <input
                  className={`${INPUT_CLS} font-mono`}
                  value={kForm.formula}
                  onChange={(e) => setKForm((f) => ({ ...f, formula: e.target.value }))}
                  placeholder="e.g. actual / target * 100"
                />
                <p className="text-text-muted text-[11px] mt-1">
                  Evaluated by the safe expression engine on the backend — no arbitrary code. An invalid formula is
                  rejected with the exact validation message.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-primary">
                <input
                  type="checkbox"
                  checked={kForm.isActive}
                  onChange={(e) => setKForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                Active
              </label>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
