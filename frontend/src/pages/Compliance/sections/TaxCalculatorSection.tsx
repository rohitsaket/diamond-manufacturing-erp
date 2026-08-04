import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Calculator, Info, RefreshCw, Scale, Wallet } from 'lucide-react';
import { complianceApi, financialYearOf } from '../../../api/compliance';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
  StatCard,
  TableShell,
  inr,
} from '../../../components/common/HrmsUI';
import { TabBar } from '../../../components/common/TabBar';
import { WidgetCard, WidgetEmpty, WidgetUnavailable } from '../../HRDashboard/WidgetCard';
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// Local helpers (date-fns is not installed)
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fyOptions(): string[] {
  const current = financialYearOf();
  const start = Number(current.slice(0, 4));
  return [start - 2, start - 1, start, start + 1].map((y) => `${y}-${y + 1}`);
}

/** Month labels for the remaining months of the year, starting next month. */
function upcomingMonthLabels(count: number): string[] {
  const now = new Date();
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    return `${MONTH_NAMES[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  });
}

const DEDUCTION_SECTIONS = [
  { key: '80C', label: '80C — PF, ELSS, life insurance' },
  { key: '80CCD1B', label: '80CCD(1B) — NPS' },
  { key: '80D', label: '80D — health insurance' },
  { key: '80E', label: '80E — education loan interest' },
  { key: '80G', label: '80G — donations' },
  { key: '80TTA', label: '80TTA/TTB — savings interest' },
];

/**
 * Regime comparison, a standalone what-if calculator, and a take-home
 * projection. Every number here is arithmetic on figures already on record —
 * nothing is saved and nothing is advice.
 */
export function TaxCalculatorSection() {
  const [tab, setTab] = useState<'compare' | 'whatif' | 'takehome'>('compare');

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: 'compare', label: 'Regime comparison' },
          { id: 'whatif', label: 'What-if calculator' },
          { id: 'takehome', label: 'Take-home' },
        ]}
        active={tab}
        onChange={(id) => setTab(id === 'whatif' ? 'whatif' : id === 'takehome' ? 'takehome' : 'compare')}
      />
      {tab === 'compare' && <CompareTab />}
      {tab === 'whatif' && <WhatIfTab />}
      {tab === 'takehome' && <TakeHomeTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ladder
// ---------------------------------------------------------------------------

function LadderRow({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className={`text-xs ${strong ? 'text-text-primary font-semibold' : muted ? 'text-text-muted' : 'text-text-secondary'}`}>
        {label}
      </span>
      <span
        className={`text-xs text-right font-mono tabular-nums ${
          strong ? 'text-text-primary font-semibold' : muted ? 'text-text-muted' : 'text-text-secondary'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function RegimeLadder({ computation }: { computation: any }) {
  return (
    <div className="space-y-0.5">
      <LadderRow label="Gross annual" value={inr(Number(computation?.grossAnnual ?? 0))} />
      <LadderRow
        label="Exemptions allowed by this regime"
        value={computation?.allowsExemptions ? 'Yes' : 'No'}
        muted
      />
      <LadderRow label="Less: standard deduction" value={`− ${inr(Number(computation?.standardDeduction ?? 0))}`} />
      <LadderRow label="Less: Chapter VI-A" value={`− ${inr(Number(computation?.chapterViaDeductions ?? 0))}`} />
      <div className="border-t border-border-light my-1" />
      <LadderRow label="Taxable income" value={inr(Number(computation?.taxableIncome ?? 0))} strong />
      <LadderRow label="Tax on slabs" value={inr(Number(computation?.taxBeforeRebate ?? 0))} />
      <LadderRow label="Less: rebate" value={`− ${inr(Number(computation?.rebate ?? 0))}`} />
      <LadderRow label="Add: surcharge" value={`+ ${inr(Number(computation?.surcharge ?? 0))}`} />
      <LadderRow label="Add: cess" value={`+ ${inr(Number(computation?.cess ?? 0))}`} />
      <div className="border-t border-border-default my-1" />
      <LadderRow label="Total tax" value={inr(Number(computation?.totalTax ?? 0))} strong />
      <LadderRow label="Effective rate" value={`${Number(computation?.effectiveRatePct ?? 0)}%`} muted />
      {Array.isArray(computation?.notes) && computation.notes.length > 0 && (
        <ul className="pt-2 space-y-0.5">
          {computation.notes.map((n: unknown, i: number) => (
            <li key={i} className="text-text-muted text-[11px]">
              {String(n)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Regime comparison
// ---------------------------------------------------------------------------

function CompareTab() {
  const { employees } = useApp();
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [financialYear, setFinancialYear] = useState<string>(financialYearOf());
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (employeeId === null && (employees ?? []).length > 0) {
      setEmployeeId(Number(employees[0]?.id ?? 0) || null);
    }
  }, [employees, employeeId]);

  const load = useCallback(() => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);
    complianceApi
      .compareRegimes(employeeId, financialYear)
      .then((res) => setData(res ?? null))
      .catch((err: any) => setError(err?.message ?? 'Could not compare regimes'))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [employeeId, financialYear]);

  useEffect(() => {
    load();
  }, [load]);

  const oldRegime = data?.old ?? null;
  const newRegime = data?.new ?? null;
  const cheaperCode = useMemo(() => {
    if (!oldRegime || !newRegime) return null;
    const oldTax = Number(oldRegime.totalTax ?? 0);
    const newTax = Number(newRegime.totalTax ?? 0);
    if (oldTax === newTax) return null;
    return oldTax < newTax ? String(oldRegime.regimeCode) : String(newRegime.regimeCode);
  }, [oldRegime, newRegime]);

  return (
    <div className="space-y-4">
      <Selector
        employees={employees ?? []}
        employeeId={employeeId}
        onEmployee={setEmployeeId}
        financialYear={financialYear}
        onFinancialYear={setFinancialYear}
        onRefresh={load}
        loading={loading}
      />

      {loading && firstLoad && <LoadingBlock label="Comparing regimes…" />}

      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button onClick={load} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      )}

      {!error && data && data.available === false && (
        <WidgetCard title="Regime comparison">
          <WidgetUnavailable reason={data.reason ? String(data.reason) : null} />
        </WidgetCard>
      )}

      {!error && data && data.available !== false && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Projected gross" value={inr(Number(data.grossAnnual ?? 0))} hint={data.grossSource ? `source: ${String(data.grossSource)}` : null} />
            <StatCard label="Current regime" value={data.currentRegimeCode ? String(data.currentRegimeCode) : '—'} />
            <StatCard
              label="Saving"
              value={inr(Number(data.saving ?? 0))}
              intent={Number(data.saving ?? 0) > 0 ? 'success' : 'default'}
            />
            <StatCard
              label="Recommended"
              value={data.recommended ? String(data.recommended) : '—'}
              intent={data.recommended ? 'success' : 'default'}
              hint={data.recommended ? null : 'no winner on these figures'}
            />
          </div>

          {/* recommended === null must never be turned into a pick. */}
          <div
            className={`px-3 py-2 rounded-md text-xs ${
              data.recommended
                ? 'bg-success-light border border-success/30 text-success'
                : 'bg-info-light border border-info/30 text-info'
            }`}
          >
            {String(data.recommendationNote ?? 'No recommendation note was returned.')}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[oldRegime, newRegime].map((regime, index) => {
              if (!regime) {
                return (
                  <WidgetCard key={index} title={index === 0 ? 'Old regime' : 'New regime'}>
                    <WidgetEmpty message="This regime is not configured for the selected year" />
                  </WidgetCard>
                );
              }
              const isCheaper = cheaperCode !== null && String(regime.regimeCode) === cheaperCode;
              return (
                <div
                  key={index}
                  className={`bg-bg-card border rounded-md p-4 ${
                    isCheaper ? 'border-success' : 'border-border-default'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                    <div className="flex items-center gap-2">
                      <Scale size={15} className="text-text-muted" />
                      <h3 className="text-text-primary text-sm font-semibold">
                        {String(regime.regimeName ?? regime.regimeCode ?? (index === 0 ? 'Old regime' : 'New regime'))}
                      </h3>
                      <Chip label={String(regime.regimeCode ?? '—')} tone="primary" />
                    </div>
                    {isCheaper && <Chip label={`Cheaper by ${inr(Number(data.saving ?? 0))}`} tone="success" />}
                  </div>
                  <RegimeLadder computation={regime} />
                </div>
              );
            })}
          </div>

          <p className="text-text-muted text-[11px] leading-relaxed">
            {data.disclaimer
              ? String(data.disclaimer)
              : 'This is arithmetic on declared figures only — anything the employee has not entered is not in these numbers.'}
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// What-if
// ---------------------------------------------------------------------------

function WhatIfTab() {
  const [annualGross, setAnnualGross] = useState('600000');
  const [financialYear, setFinancialYear] = useState<string>(financialYearOf());
  const [regimeCode, setRegimeCode] = useState('');
  const [deductions, setDeductions] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalDeductions = Object.values(deductions).reduce((sum, v) => sum + (Number(v) || 0), 0);

  const calculate = () => {
    setBusy(true);
    setError(null);
    const numeric: Record<string, number> = {};
    for (const [key, value] of Object.entries(deductions)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) numeric[key] = n;
    }
    complianceApi
      .calculate({
        annualGross: Number(annualGross) || 0,
        financialYear,
        regimeCode: regimeCode || undefined,
        deductions: numeric,
      })
      .then((res) => setResult(res ?? null))
      .catch((err: any) => {
        setError(err?.message ?? 'The calculation failed');
        window.alert(err?.message ?? 'The calculation failed');
      })
      .finally(() => setBusy(false));
  };

  const results: any[] = Array.isArray(result?.results) ? result.results : [];
  const chartData = results.map((r) => ({
    regime: String(r?.regimeCode ?? '—'),
    'Taxable income': Number(r?.taxableIncome ?? 0),
    'Total tax': Number(r?.totalTax ?? 0),
  }));

  return (
    <div className="space-y-4">
      <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-3">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className={LABEL_CLS} htmlFor="wi-gross">
              Annual gross
            </label>
            <input
              id="wi-gross"
              className={`${INPUT_CLS} w-40 text-right font-mono`}
              value={annualGross}
              onChange={(e) => setAnnualGross(e.target.value.replace(/[^\d.]/g, ''))}
            />
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="wi-fy">
              Financial year
            </label>
            <select
              id="wi-fy"
              className={`${INPUT_CLS} w-36`}
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
            >
              {fyOptions().map((fy) => (
                <option key={fy} value={fy}>
                  {fy}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="wi-regime">
              Regime
            </label>
            <select
              id="wi-regime"
              className={`${INPUT_CLS} w-40`}
              value={regimeCode}
              onChange={(e) => setRegimeCode(e.target.value)}
            >
              <option value="">Both regimes</option>
              {results.map((r) => (
                <option key={String(r?.regimeCode)} value={String(r?.regimeCode)}>
                  {String(r?.regimeCode)}
                </option>
              ))}
            </select>
          </div>
          <button onClick={calculate} className={BTN_PRIMARY} disabled={busy}>
            <Calculator size={14} className="inline mr-1.5" />
            {busy ? 'Calculating…' : 'Calculate'}
          </button>
        </div>

        <div>
          <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold mb-2">
            Chapter VI-A deductions (total {inr(totalDeductions)})
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {DEDUCTION_SECTIONS.map((section) => (
              <div key={section.key}>
                <label className={LABEL_CLS} htmlFor={`wi-${section.key}`}>
                  {section.label}
                </label>
                <input
                  id={`wi-${section.key}`}
                  className={`${INPUT_CLS} text-right font-mono`}
                  value={deductions[section.key] ?? ''}
                  placeholder="0"
                  onChange={(e) =>
                    setDeductions((prev) => ({ ...prev, [section.key]: e.target.value.replace(/[^\d.]/g, '') }))
                  }
                />
              </div>
            ))}
          </div>
          <p className="text-text-muted text-[11px] mt-2 flex items-start gap-1.5">
            <Info size={12} className="flex-shrink-0 mt-0.5" />
            Nothing here is saved. This is a scratchpad against the configured slabs — it does not touch any
            employee&rsquo;s declaration, and the section caps that payroll applies are not enforced on these inputs:
            the backend simply sums them.
          </p>
        </div>
      </div>

      {error && <ErrorBlock message={error} />}

      {result && result.available === false && (
        <WidgetCard title="What-if calculation">
          <WidgetUnavailable reason={result.reason ? String(result.reason) : null} />
        </WidgetCard>
      )}

      {result && result.available !== false && results.length > 0 && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {results.map((r) => (
              <div
                key={String(r?.regimeId ?? r?.regimeCode)}
                className={`bg-bg-card border rounded-md p-4 ${
                  result.recommended && String(result.recommended) === String(r?.regimeCode)
                    ? 'border-success'
                    : 'border-border-default'
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-text-primary text-sm font-semibold">{String(r?.regimeName ?? '—')}</h3>
                    <Chip label={String(r?.regimeCode ?? '—')} tone="primary" />
                  </div>
                  {result.recommended && String(result.recommended) === String(r?.regimeCode) && (
                    <Chip label={`Cheaper by ${inr(Number(result.saving ?? 0))}`} tone="success" />
                  )}
                </div>
                <RegimeLadder computation={r} />
              </div>
            ))}
          </div>

          {!result.recommended && (
            <div className="px-3 py-2 rounded-md bg-info-light border border-info/30 text-info text-xs">
              No regime is recommended — either only one regime is configured for {String(result.financialYear ?? financialYear)},
              or both produce the same tax on these figures.
            </div>
          )}

          <WidgetCard
            title="Regime comparison"
            subtitle={`Annual gross ${inr(Number(result.annualGross ?? 0))} · deductions applied ${inr(Number(result.deductionsApplied ?? 0))}`}
          >
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border-light" />
                  <XAxis dataKey="regime" tick={{ fontSize: 11 }} stroke="currentColor" className="text-text-muted" />
                  <YAxis tick={{ fontSize: 11 }} stroke="currentColor" className="text-text-muted" width={80} />
                  <Tooltip formatter={(value: any) => inr(Number(value))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Taxable income" fill="currentColor" className="text-info" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Total tax" fill="currentColor" className="text-primary" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </WidgetCard>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Take-home
// ---------------------------------------------------------------------------

function TakeHomeTab() {
  const { employees } = useApp();
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [financialYear, setFinancialYear] = useState<string>(financialYearOf());
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (employeeId === null && (employees ?? []).length > 0) {
      setEmployeeId(Number(employees[0]?.id ?? 0) || null);
    }
  }, [employees, employeeId]);

  const load = useCallback(() => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);
    complianceApi
      .takeHome(employeeId, financialYear)
      .then((res) => setData(res ?? null))
      .catch((err: any) => setError(err?.message ?? 'Could not project take-home'))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [employeeId, financialYear]);

  useEffect(() => {
    load();
  }, [load]);

  const statutory = data?.statutoryDeductions ?? {};
  const statutoryTotal =
    Number(statutory?.pf ?? 0) + Number(statutory?.esi ?? 0) + Number(statutory?.pt ?? 0) + Number(statutory?.lwf ?? 0);
  const monthsRemaining = Number(data?.monthsRemaining ?? 0);

  const chartData = useMemo(() => {
    if (!data || data.available === false) return [];
    const labels = upcomingMonthLabels(monthsRemaining);
    const gross = Number(data.monthlyGross ?? 0);
    const net = Number(data.monthlyNet ?? 0);
    let cumulativeGross = 0;
    let cumulativeNet = 0;
    return labels.map((label) => {
      cumulativeGross += gross;
      cumulativeNet += net;
      return { month: label, 'Cumulative gross': cumulativeGross, 'Cumulative net': cumulativeNet };
    });
  }, [data, monthsRemaining]);

  const caveats: string[] = Array.isArray(data?.caveats) ? data.caveats.map(String) : [];

  return (
    <div className="space-y-4">
      <Selector
        employees={employees ?? []}
        employeeId={employeeId}
        onEmployee={setEmployeeId}
        financialYear={financialYear}
        onFinancialYear={setFinancialYear}
        onRefresh={load}
        loading={loading}
      />

      {loading && firstLoad && <LoadingBlock label="Projecting take-home…" />}

      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button onClick={load} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      )}

      {!error && data && data.available === false && (
        <WidgetCard title="Take-home projection">
          <WidgetUnavailable reason={data.reason ? String(data.reason) : null} />
        </WidgetCard>
      )}

      {!error && data && data.available !== false && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Monthly gross" value={inr(Number(data.monthlyGross ?? 0))} hint={data.grossSource ? `source: ${String(data.grossSource)}` : null} />
            <StatCard label="Monthly TDS" value={inr(Number(data.monthlyTds ?? 0))} intent="warning" />
            <StatCard label="Monthly net" value={inr(Number(data.monthlyNet ?? 0))} intent="success" />
            <StatCard label="Months remaining" value={monthsRemaining} hint={String(financialYear)} />
          </div>

          <TableShell headers={['Line', 'Per month', `Remaining ${monthsRemaining} month(s)`]}>
            <MoneyRow label="Gross" monthly={Number(data.monthlyGross ?? 0)} months={monthsRemaining} />
            <MoneyRow label="Provident fund" monthly={-Number(statutory?.pf ?? 0)} months={monthsRemaining} />
            <MoneyRow label="ESI" monthly={-Number(statutory?.esi ?? 0)} months={monthsRemaining} />
            <MoneyRow label="Professional tax" monthly={-Number(statutory?.pt ?? 0)} months={monthsRemaining} />
            <MoneyRow label="Labour welfare fund" monthly={-Number(statutory?.lwf ?? 0)} months={monthsRemaining} />
            <MoneyRow label="Statutory deductions" monthly={-statutoryTotal} months={monthsRemaining} strong />
            <MoneyRow label="TDS" monthly={-Number(data.monthlyTds ?? 0)} months={monthsRemaining} />
            <tr className="bg-bg-secondary">
              <td className="px-3 py-2 text-sm font-semibold text-text-primary">Net take-home</td>
              <td className="px-3 py-2 text-sm text-right font-mono font-semibold text-success">
                {inr(Number(data.monthlyNet ?? 0))}
              </td>
              <td className="px-3 py-2 text-sm text-right font-mono font-semibold text-success">
                {inr(Number(data.remainingNet ?? 0))}
              </td>
            </tr>
          </TableShell>

          <p className="text-text-muted text-[11px]">
            Statutory figures come from {String(statutory?.source ?? 'no source on record')}. Annual tax{' '}
            {inr(Number(data.annual?.totalTax ?? 0))}, of which {inr(Number(data.annual?.taxPaidToDate ?? 0))} has been
            deducted and {inr(Number(data.annual?.remainingTax ?? 0))} remains, on regime{' '}
            {String(data.annual?.regimeCode ?? '—')}.
          </p>

          {caveats.length > 0 && (
            <ul className="list-disc pl-4 text-text-muted text-[11px] space-y-0.5">
              {caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}

          <WidgetCard title="Projected cumulative pay" subtitle="Flat projection of the remaining months">
            {chartData.length === 0 ? (
              <WidgetEmpty message="No remaining months to project" />
            ) : (
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border-light" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="currentColor" className="text-text-muted" />
                    <YAxis tick={{ fontSize: 11 }} stroke="currentColor" className="text-text-muted" width={80} />
                    <Tooltip formatter={(value: any) => inr(Number(value))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      type="monotone"
                      dataKey="Cumulative gross"
                      stroke="currentColor"
                      className="text-info"
                      dot={false}
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="Cumulative net"
                      stroke="currentColor"
                      className="text-success"
                      dot={false}
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </WidgetCard>
        </>
      )}
    </div>
  );
}

function MoneyRow({
  label,
  monthly,
  months,
  strong = false,
}: {
  label: string;
  monthly: number;
  months: number;
  strong?: boolean;
}) {
  const cls = strong ? 'font-semibold text-text-primary' : 'text-text-secondary';
  return (
    <tr className="hover:bg-bg-hover transition-colors">
      <td className={`px-3 py-2 text-sm ${cls}`}>{label}</td>
      <td className={`px-3 py-2 text-sm text-right font-mono ${cls}`}>
        {monthly < 0 ? `− ${inr(Math.abs(monthly))}` : inr(monthly)}
      </td>
      <td className={`px-3 py-2 text-sm text-right font-mono ${cls}`}>
        {monthly < 0 ? `− ${inr(Math.abs(monthly) * months)}` : inr(monthly * months)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Shared selector
// ---------------------------------------------------------------------------

function Selector({
  employees,
  employeeId,
  onEmployee,
  financialYear,
  onFinancialYear,
  onRefresh,
  loading,
}: {
  employees: { id: number; empCode: string; fullName: string }[];
  employeeId: number | null;
  onEmployee: (id: number | null) => void;
  financialYear: string;
  onFinancialYear: (fy: string) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className={LABEL_CLS} htmlFor="calc-emp">
            Employee
          </label>
          <select
            id="calc-emp"
            className={`${INPUT_CLS} min-w-[220px]`}
            value={employeeId ?? ''}
            onChange={(e) => onEmployee(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Select an employee</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.empCode} · {emp.fullName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="calc-fy">
            Financial year
          </label>
          <select
            id="calc-fy"
            className={`${INPUT_CLS} w-36`}
            value={financialYear}
            onChange={(e) => onFinancialYear(e.target.value)}
          >
            {fyOptions().map((fy) => (
              <option key={fy} value={fy}>
                {fy}
              </option>
            ))}
          </select>
        </div>
        <button onClick={onRefresh} className={BTN_SECONDARY} disabled={loading || !employeeId}>
          <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <span className="text-text-muted text-[11px] inline-flex items-center gap-1.5">
          <Wallet size={12} /> Figures are projections from what payroll already holds.
        </span>
      </div>
    </div>
  );
}
