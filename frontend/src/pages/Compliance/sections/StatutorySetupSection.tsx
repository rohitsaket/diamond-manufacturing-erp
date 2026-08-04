import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Info, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { statutoryApi } from '../../../api/compliance';
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

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : inr(n);
}

function pct(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : `${n}%`;
}

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

/** `2026-04-01T00:00:00.000Z` → `2026-04-01`, for date inputs. */
function toDateInput(value: unknown): string {
  if (!value) return '';
  const s = String(value);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function regTone(regType: unknown): Tone {
  switch (String(regType ?? '').toUpperCase()) {
    case 'PF':
      return 'primary';
    case 'ESI':
      return 'success';
    case 'PT':
    case 'LWF':
      return 'warning';
    case 'TAN':
      return 'danger';
    default:
      return 'default';
  }
}

const REG_TYPES = ['PF', 'ESI', 'PT', 'LWF', 'TAN', 'GRATUITY', 'SHOPS_ESTABLISHMENT', 'OTHER'] as const;

interface SlabDraft {
  fromAmount: string;
  toAmount: string;
  taxAmount: string;
  specialMonth: string;
  specialMonthAmount: string;
}

// ---------------------------------------------------------------------------

export function StatutorySetupSection() {
  const [tab, setTab] = useState<string>('schemes');

  const [configs, setConfigs] = useState<any[]>([]);
  const [ptRules, setPtRules] = useState<any[]>([]);
  const [lwfRules, setLwfRules] = useState<any[]>([]);
  const [minWage, setMinWage] = useState<any[]>([]);
  const [registrations, setRegistrations] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Scheme editor
  const [configDraft, setConfigDraft] = useState<Record<string, string> | null>(null);
  const [configId, setConfigId] = useState<number | null>(null);
  const [configBusy, setConfigBusy] = useState(false);

  // PT
  const [ptRuleId, setPtRuleId] = useState<number | null>(null);
  const [slabDrafts, setSlabDrafts] = useState<SlabDraft[] | null>(null);
  const [slabBusy, setSlabBusy] = useState(false);

  // Registrations
  const [regDraft, setRegDraft] = useState<Record<string, string> | null>(null);
  const [regId, setRegId] = useState<number | null>(null);
  const [regBusy, setRegBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      statutoryApi.config(),
      statutoryApi.ptRules().catch(() => [] as any[]),
      statutoryApi.lwfRules().catch(() => [] as any[]),
      statutoryApi.minimumWage().catch(() => [] as any[]),
      statutoryApi.registrations().catch(() => [] as any[]),
    ])
      .then(([cfg, pt, lwf, mw, regs]) => {
        setConfigs(Array.isArray(cfg) ? cfg : []);
        setPtRules(Array.isArray(pt) ? pt : []);
        setLwfRules(Array.isArray(lwf) ? lwf : []);
        setMinWage(Array.isArray(mw) ? mw : []);
        setRegistrations(Array.isArray(regs) ? regs : []);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Default the PT rule selection once rules arrive.
  useEffect(() => {
    if (ptRuleId === null && ptRules.length > 0) setPtRuleId(num(ptRules[0]?.id));
  }, [ptRules, ptRuleId]);

  const selectedRule = useMemo(
    () => ptRules.find((r) => num(r?.id) === ptRuleId) ?? null,
    [ptRules, ptRuleId],
  );

  const ruleSlabs: any[] = useMemo(
    () => (Array.isArray(selectedRule?.slabs) ? selectedRule.slabs : []),
    [selectedRule],
  );

  // --- Scheme configuration -------------------------------------------------

  const openConfigEditor = useCallback((row: any) => {
    setConfigId(num(row?.id));
    setConfigDraft({
      effectiveFrom: toDateInput(row?.effective_from),
      effectiveTo: toDateInput(row?.effective_to),
      employeeRatePct: String(row?.employee_rate_pct ?? ''),
      employerRatePct: String(row?.employer_rate_pct ?? ''),
      diversionRatePct: String(row?.diversion_rate_pct ?? ''),
      wageCeiling: String(row?.wage_ceiling ?? ''),
      diversionCeiling: String(row?.diversion_ceiling ?? ''),
      adminChargePct: String(row?.admin_charge_pct ?? ''),
      minAdminCharge: String(row?.min_admin_charge ?? ''),
      gratuityDaysPerYear: String(row?.gratuity_days_per_year ?? ''),
      gratuityDenominator: String(row?.gratuity_denominator ?? ''),
      gratuityMinYears: String(row?.gratuity_min_years ?? ''),
      gratuityMaxAmount: String(row?.gratuity_max_amount ?? ''),
      filingDueDay: String(row?.filing_due_day ?? ''),
      notes: String(row?.notes ?? ''),
    });
  }, []);

  const saveConfig = useCallback(() => {
    if (configId === null || configDraft === null) return;
    setConfigBusy(true);
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(configDraft)) {
      if (value === '') {
        body[key] = null;
        continue;
      }
      body[key] = key === 'notes' ? value : (num(value) ?? value);
    }
    statutoryApi
      .updateConfig(configId, body)
      .then(() => {
        setConfigDraft(null);
        setConfigId(null);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setConfigBusy(false));
  }, [configId, configDraft, load]);

  // --- PT slabs --------------------------------------------------------------

  const openSlabEditor = useCallback(() => {
    setSlabDrafts(
      ruleSlabs.map((s) => ({
        fromAmount: String(s?.from_amount ?? ''),
        toAmount: s?.to_amount === null || s?.to_amount === undefined ? '' : String(s.to_amount),
        taxAmount: String(s?.tax_amount ?? ''),
        specialMonth: s?.special_month === null || s?.special_month === undefined ? '' : String(s.special_month),
        specialMonthAmount:
          s?.special_month_amount === null || s?.special_month_amount === undefined
            ? ''
            : String(s.special_month_amount),
      })),
    );
  }, [ruleSlabs]);

  const saveSlabs = useCallback(() => {
    if (ptRuleId === null || slabDrafts === null) return;
    setSlabBusy(true);
    const payload = slabDrafts.map((s, index) => ({
      fromAmount: num(s.fromAmount) ?? 0,
      toAmount: s.toAmount === '' ? null : num(s.toAmount),
      taxAmount: num(s.taxAmount) ?? 0,
      specialMonth: s.specialMonth === '' ? null : num(s.specialMonth),
      specialMonthAmount: s.specialMonthAmount === '' ? null : num(s.specialMonthAmount),
      slabOrder: index + 1,
    }));
    statutoryApi
      .savePtSlabs(ptRuleId, payload)
      .then(() => {
        setSlabDrafts(null);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSlabBusy(false));
  }, [ptRuleId, slabDrafts, load]);

  // --- Registrations ---------------------------------------------------------

  const openRegEditor = useCallback((row: any | null) => {
    setRegId(row ? num(row?.id) : null);
    setRegDraft({
      regType: String(row?.regType ?? 'PF'),
      registrationNo: String(row?.registrationNo ?? ''),
      legalEntity: String(row?.legalEntity ?? ''),
      company: String(row?.company ?? ''),
      branch: String(row?.branch ?? ''),
      stateCode: String(row?.stateCode ?? ''),
      authorityName: String(row?.authorityName ?? ''),
      registeredOn: toDateInput(row?.registeredOn),
      validUntil: toDateInput(row?.validUntil),
      contactPerson: String(row?.contactPerson ?? ''),
      contactPhone: String(row?.contactPhone ?? ''),
      notes: String(row?.notes ?? ''),
    });
  }, []);

  const saveRegistration = useCallback(() => {
    if (regDraft === null) return;
    if (!regDraft.registrationNo.trim()) {
      window.alert('A registration number is required');
      return;
    }
    setRegBusy(true);
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(regDraft)) body[key] = value === '' ? null : value;

    const request =
      regId === null ? statutoryApi.createRegistration(body) : statutoryApi.updateRegistration(regId, body);

    request
      .then(() => {
        setRegDraft(null);
        setRegId(null);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setRegBusy(false));
  }, [regDraft, regId, load]);

  if (firstLoad && loading) return <LoadingBlock label="Loading statutory configuration…" />;

  const tabs = [
    { id: 'schemes', label: 'Schemes', count: configs.length },
    { id: 'pt', label: 'Professional tax', count: ptRules.length },
    { id: 'lwf', label: 'LWF', count: lwfRules.length },
    { id: 'minwage', label: 'Minimum wage', count: minWage.length },
    { id: 'registrations', label: 'Registrations', count: registrations.length },
  ];

  return (
    <div className="space-y-4">
      {/* Not-legal-advice callout ------------------------------------------ */}
      <div className="rounded-md bg-info-light border border-primary/20 px-4 py-3 flex items-start gap-2">
        <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-text-primary text-sm font-medium">
            These rates and slabs are editable configuration, not legal advice. Verify against the current Act and
            state notification before filing.
          </p>
          <p className="text-text-secondary text-xs mt-0.5">
            Nothing here is hard-coded in the application — every figure below is what the payroll and contribution
            engine will actually use.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
        <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
          <span className="inline-flex items-center gap-2">
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
            Refresh
          </span>
        </button>
      </div>

      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {/* Schemes ------------------------------------------------------------ */}
      {tab === 'schemes' && (
        <div className="space-y-3">
          {configs.length === 0 ? (
            <EmptyBlock message="No scheme configuration rows" />
          ) : (
            <TableShell
              headers={[
                'Scheme',
                'Effective from',
                'Employee %',
                'Employer %',
                'Diversion %',
                'Ceiling',
                'Admin charge',
                'Gratuity',
                'Due day',
                'Active',
                '',
              ]}
            >
              {configs.map((c, index) => (
                <tr key={c?.id ?? index} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-primary font-medium whitespace-nowrap">
                    {text(c?.scheme)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {fmtDate(c?.effective_from)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {pct(c?.employee_rate_pct)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {pct(c?.employer_rate_pct)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {pct(c?.diversion_rate_pct)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {money(c?.wage_ceiling)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                    {pct(c?.admin_charge_pct)}
                    {num(c?.min_admin_charge) !== null && (
                      <span className="block text-[10px]">min {money(c?.min_admin_charge)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                    {num(c?.gratuity_days_per_year) === null
                      ? '—'
                      : `${c.gratuity_days_per_year}/${text(c?.gratuity_denominator)}`}
                    {num(c?.gratuity_min_years) !== null && (
                      <span className="block text-[10px]">min {c.gratuity_min_years}y</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                    {text(c?.filing_due_day)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip
                      label={truthy(c?.is_active) ? 'Active' : 'Inactive'}
                      tone={truthy(c?.is_active) ? 'success' : 'default'}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-primary text-xs font-medium hover:underline"
                      onClick={() => openConfigEditor(c)}
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </TableShell>
          )}

          {/* The convention that caused a real bug — spelled out in the UI. */}
          <div className="rounded-md border border-border-light bg-bg-secondary px-4 py-3">
            <p className="text-text-muted text-[11px] leading-relaxed">
              <span className="font-semibold text-text-secondary">PF convention:</span>{' '}
              <span className="font-mono text-text-secondary">employerRatePct</span> is the{' '}
              <span className="font-semibold">total</span> employer share (12%), and the EPS diversion is{' '}
              <span className="font-semibold">subtracted from it</span> — it is not an extra cost on top. Employer EPF
              therefore lands at employerRatePct minus the diversion rate, and employer EPF + EPS must reconcile back
              to the employee 12%. If you enter the post-diversion rate (3.67) here instead, the ledger will
              under-collect.
            </p>
          </div>
        </div>
      )}

      {/* Professional tax ---------------------------------------------------- */}
      {tab === 'pt' && (
        <div className="space-y-3">
          {ptRules.length === 0 ? (
            <EmptyBlock message="No professional tax state rules" />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {ptRules.map((r, index) => {
                  const active = num(r?.id) === ptRuleId;
                  return (
                    <button
                      key={r?.id ?? index}
                      type="button"
                      onClick={() => setPtRuleId(num(r?.id))}
                      className={`text-left rounded-md border p-3 transition-colors ${
                        active
                          ? 'bg-bg-selected border-primary/40'
                          : 'bg-bg-card border-border-default hover:bg-bg-hover'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-text-primary text-sm font-medium">
                          {text(r?.state_name)} ({text(r?.state_code)})
                        </p>
                        <Chip
                          label={truthy(r?.is_active) ? 'Active' : 'Inactive'}
                          tone={truthy(r?.is_active) ? 'success' : 'default'}
                        />
                      </div>
                      <p className="text-text-muted text-[11px] mt-1">
                        {text(r?.frequency)} · from {fmtDate(r?.effective_from)}
                        {num(r?.annual_cap) !== null ? ` · cap ${money(r?.annual_cap)}` : ''}
                      </p>
                      <p className="text-text-muted text-[11px]">
                        {(Array.isArray(r?.slabs) ? r.slabs.length : 0)} slabs
                        {num(r?.filing_due_day) !== null ? ` · due day ${r.filing_due_day}` : ''}
                      </p>
                    </button>
                  );
                })}
              </div>

              {selectedRule && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-text-primary text-sm font-semibold">
                      Slab ladder — {text(selectedRule?.state_name)}
                    </p>
                    <button type="button" className={BTN_SECONDARY} onClick={openSlabEditor}>
                      <span className="inline-flex items-center gap-2">
                        <Pencil size={14} />
                        Edit slabs
                      </span>
                    </button>
                  </div>
                  {ruleSlabs.length === 0 ? (
                    <EmptyBlock message="This state rule has no slabs yet" />
                  ) : (
                    <TableShell headers={['From', 'To', 'Amount', 'Special month', 'Special month amount']}>
                      {ruleSlabs.map((s, index) => (
                        <tr key={s?.id ?? index} className="hover:bg-bg-hover transition-colors">
                          <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                            {money(s?.from_amount)}
                          </td>
                          <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                            {s?.to_amount === null || s?.to_amount === undefined ? 'and above' : money(s.to_amount)}
                          </td>
                          <td className="px-3 py-2 text-xs text-text-primary font-mono text-right whitespace-nowrap">
                            {money(s?.tax_amount)}
                          </td>
                          <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                            {text(s?.special_month)}
                          </td>
                          <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                            {s?.special_month_amount === null || s?.special_month_amount === undefined
                              ? '—'
                              : money(s.special_month_amount)}
                          </td>
                        </tr>
                      ))}
                    </TableShell>
                  )}
                  {typeof selectedRule?.notes === 'string' && selectedRule.notes !== '' && (
                    <p className="text-text-muted text-[11px]">{selectedRule.notes}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* LWF ----------------------------------------------------------------- */}
      {tab === 'lwf' && (
        <div className="space-y-2">
          <p className="text-text-muted text-[11px]">Read-only. Labour welfare fund rules are seeded per state.</p>
          {lwfRules.length === 0 ? (
            <EmptyBlock message="No labour welfare fund rules" />
          ) : (
            <TableShell
              headers={[
                'State',
                'Frequency',
                'Employee',
                'Employer',
                'Wage ceiling',
                'Deduction months',
                'Effective from',
                'Effective to',
                'Active',
              ]}
            >
              {lwfRules.map((r, index) => (
                <tr key={r?.id ?? index} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                    {text(r?.state_name)} <span className="text-text-muted font-mono">({text(r?.state_code)})</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(r?.frequency)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {money(r?.employee_contribution)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {money(r?.employer_contribution)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                    {money(r?.wage_ceiling)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted font-mono whitespace-nowrap">
                    {text(r?.deduction_months)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {fmtDate(r?.effective_from)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(r?.effective_to)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip
                      label={truthy(r?.is_active) ? 'Active' : 'Inactive'}
                      tone={truthy(r?.is_active) ? 'success' : 'default'}
                    />
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* Minimum wage --------------------------------------------------------- */}
      {tab === 'minwage' && (
        <div className="space-y-2">
          <p className="text-text-muted text-[11px]">
            Read-only. These floors are what the minimum-wage compliance check compares against.
          </p>
          {minWage.length === 0 ? (
            <EmptyBlock message="No minimum wage rules" />
          ) : (
            <TableShell
              headers={[
                'State',
                'Skill level',
                'Industry',
                'Monthly minimum',
                'Daily minimum',
                'Effective from',
                'Effective to',
                'Active',
              ]}
            >
              {minWage.map((r, index) => (
                <tr key={r?.id ?? index} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                    {text(r?.state_name)} <span className="text-text-muted font-mono">({text(r?.state_code)})</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(r?.skill_level)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{text(r?.industry)}</td>
                  <td className="px-3 py-2 text-xs text-text-primary font-mono text-right whitespace-nowrap">
                    {money(r?.monthly_minimum)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {money(r?.daily_minimum)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {fmtDate(r?.effective_from)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(r?.effective_to)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip
                      label={truthy(r?.is_active) ? 'Active' : 'Inactive'}
                      tone={truthy(r?.is_active) ? 'success' : 'default'}
                    />
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* Registrations --------------------------------------------------------- */}
      {tab === 'registrations' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-text-muted text-[11px]">
              Establishment identifiers. These are company registration numbers, not personal data, so they are shown
              in full.
            </p>
            <button type="button" className={BTN_PRIMARY} onClick={() => openRegEditor(null)}>
              <span className="inline-flex items-center gap-2">
                <Plus size={14} />
                Add registration
              </span>
            </button>
          </div>
          {registrations.length === 0 ? (
            <EmptyBlock message="No statutory registrations recorded" />
          ) : (
            <TableShell
              headers={['Type', 'Registration no', 'Entity', 'State', 'Authority', 'Registered on', 'Active', '']}
            >
              {registrations.map((r, index) => (
                <tr key={r?.id ?? index} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(r?.regType)} tone={regTone(r?.regType)} />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-primary font-mono whitespace-nowrap">
                    {text(r?.registrationNo)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {text(r?.legalEntity ?? r?.company)}
                    {r?.branch ? <span className="block text-text-muted text-[11px]">{r.branch}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono whitespace-nowrap">
                    {text(r?.stateCode)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {text(r?.authorityName)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {fmtDate(r?.registeredOn)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip
                      label={truthy(r?.isActive) ? 'Active' : 'Inactive'}
                      tone={truthy(r?.isActive) ? 'success' : 'default'}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-primary text-xs font-medium hover:underline"
                      onClick={() => openRegEditor(r)}
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* Scheme editor modal --------------------------------------------------- */}
      <AnimatePresence>
        {configDraft !== null && (
          <ModalShell
            title="Edit scheme configuration"
            subtitle="Blank a field to clear it"
            onClose={() => setConfigDraft(null)}
            maxWidth="max-w-2xl"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setConfigDraft(null)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={saveConfig} disabled={configBusy}>
                  {configBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(
                [
                  ['effectiveFrom', 'Effective from', 'date'],
                  ['effectiveTo', 'Effective to', 'date'],
                  ['employeeRatePct', 'Employee rate %', 'number'],
                  ['employerRatePct', 'Employer rate % (total)', 'number'],
                  ['diversionRatePct', 'EPS diversion rate %', 'number'],
                  ['wageCeiling', 'Wage ceiling', 'number'],
                  ['diversionCeiling', 'Diversion ceiling', 'number'],
                  ['adminChargePct', 'Admin charge %', 'number'],
                  ['minAdminCharge', 'Minimum admin charge', 'number'],
                  ['gratuityDaysPerYear', 'Gratuity days per year', 'number'],
                  ['gratuityDenominator', 'Gratuity denominator', 'number'],
                  ['gratuityMinYears', 'Gratuity minimum years', 'number'],
                  ['gratuityMaxAmount', 'Gratuity maximum amount', 'number'],
                  ['filingDueDay', 'Filing due day', 'number'],
                ] as [string, string, string][]
              ).map(([key, label, type]) => (
                <div key={key}>
                  <label className={LABEL_CLS} htmlFor={`cfg-${key}`}>
                    {label}
                  </label>
                  <input
                    id={`cfg-${key}`}
                    type={type}
                    step="any"
                    className={INPUT_CLS}
                    value={configDraft[key] ?? ''}
                    onChange={(e) =>
                      setConfigDraft((prev) => (prev === null ? prev : { ...prev, [key]: e.target.value }))
                    }
                  />
                </div>
              ))}
              <div className="sm:col-span-2">
                <label className={LABEL_CLS} htmlFor="cfg-notes">
                  Notes
                </label>
                <input
                  id="cfg-notes"
                  className={INPUT_CLS}
                  value={configDraft.notes ?? ''}
                  onChange={(e) =>
                    setConfigDraft((prev) => (prev === null ? prev : { ...prev, notes: e.target.value }))
                  }
                />
              </div>
              <p className="sm:col-span-2 text-text-muted text-[11px]">
                Employer rate % is the total employer share. The EPS diversion is taken out of it, not added on top.
              </p>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Slab editor modal ----------------------------------------------------- */}
      <AnimatePresence>
        {slabDrafts !== null && (
          <ModalShell
            title={`Edit slabs — ${text(selectedRule?.state_name)}`}
            subtitle="Saving replaces the whole ladder for this rule"
            onClose={() => setSlabDrafts(null)}
            maxWidth="max-w-3xl"
            footer={
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  onClick={() =>
                    setSlabDrafts((prev) =>
                      prev === null
                        ? prev
                        : [
                            ...prev,
                            {
                              fromAmount: '',
                              toAmount: '',
                              taxAmount: '',
                              specialMonth: '',
                              specialMonthAmount: '',
                            },
                          ],
                    )
                  }
                >
                  <span className="inline-flex items-center gap-2">
                    <Plus size={14} />
                    Add slab
                  </span>
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" className={BTN_SECONDARY} onClick={() => setSlabDrafts(null)}>
                    Cancel
                  </button>
                  <button type="button" className={BTN_PRIMARY} onClick={saveSlabs} disabled={slabBusy}>
                    {slabBusy ? 'Saving…' : 'Save slabs'}
                  </button>
                </div>
              </div>
            }
          >
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] gap-2 px-1">
                {['From', 'To (blank = above)', 'Amount', 'Special month', 'Special amount', ''].map((h) => (
                  <span key={h} className={LABEL_CLS}>
                    {h}
                  </span>
                ))}
              </div>
              {slabDrafts.length === 0 && (
                <p className="text-text-muted text-xs py-4 text-center">No slabs. Add one to start the ladder.</p>
              )}
              {slabDrafts.map((slab, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] gap-2 items-center">
                  {(['fromAmount', 'toAmount', 'taxAmount', 'specialMonth', 'specialMonthAmount'] as const).map(
                    (field) => (
                      <input
                        key={field}
                        type="number"
                        step="any"
                        className={INPUT_CLS}
                        value={slab[field]}
                        onChange={(e) =>
                          setSlabDrafts((prev) =>
                            prev === null
                              ? prev
                              : prev.map((s, i) => (i === index ? { ...s, [field]: e.target.value } : s)),
                          )
                        }
                      />
                    ),
                  )}
                  <button
                    type="button"
                    aria-label="Remove slab"
                    className="text-text-muted hover:text-danger transition-colors"
                    onClick={() =>
                      setSlabDrafts((prev) => (prev === null ? prev : prev.filter((_, i) => i !== index)))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Registration modal ------------------------------------------------------ */}
      <AnimatePresence>
        {regDraft !== null && (
          <ModalShell
            title={regId === null ? 'Add a registration' : 'Edit registration'}
            onClose={() => setRegDraft(null)}
            maxWidth="max-w-2xl"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setRegDraft(null)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={saveRegistration} disabled={regBusy}>
                  {regBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS} htmlFor="reg-type">
                  Type
                </label>
                <select
                  id="reg-type"
                  className={INPUT_CLS}
                  value={regDraft.regType}
                  onChange={(e) =>
                    setRegDraft((prev) => (prev === null ? prev : { ...prev, regType: e.target.value }))
                  }
                >
                  {REG_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
              {(
                [
                  ['registrationNo', 'Registration number', 'text'],
                  ['legalEntity', 'Legal entity', 'text'],
                  ['company', 'Company', 'text'],
                  ['branch', 'Branch', 'text'],
                  ['stateCode', 'State code', 'text'],
                  ['authorityName', 'Authority', 'text'],
                  ['registeredOn', 'Registered on', 'date'],
                  ['validUntil', 'Valid until', 'date'],
                  ['contactPerson', 'Contact person', 'text'],
                  ['contactPhone', 'Contact phone', 'text'],
                ] as [string, string, string][]
              ).map(([key, label, type]) => (
                <div key={key}>
                  <label className={LABEL_CLS} htmlFor={`reg-${key}`}>
                    {label}
                  </label>
                  <input
                    id={`reg-${key}`}
                    type={type}
                    className={INPUT_CLS}
                    value={regDraft[key] ?? ''}
                    onChange={(e) => setRegDraft((prev) => (prev === null ? prev : { ...prev, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="sm:col-span-2">
                <label className={LABEL_CLS} htmlFor="reg-notes">
                  Notes
                </label>
                <input
                  id="reg-notes"
                  className={INPUT_CLS}
                  value={regDraft.notes ?? ''}
                  onChange={(e) => setRegDraft((prev) => (prev === null ? prev : { ...prev, notes: e.target.value }))}
                />
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
