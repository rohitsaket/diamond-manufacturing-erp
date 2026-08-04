/**
 * Pure statutory rule resolution and arithmetic.
 *
 * Nothing in this file reads the database, the clock or any global state: every
 * function takes the configuration rows it needs as arguments and returns a
 * value. That is deliberate. These are the numbers that end up on an EPFO ECR,
 * an ESIC challan and a Form 24Q, so they have to be reproducible from their
 * inputs alone and unit-testable without a server.
 *
 * Every rate, ceiling, slab and threshold arrives from `statutory_config`,
 * `pt_state_rules`/`pt_state_slabs`, `lwf_state_rules` and `minimum_wage_rules`.
 * Not one of them is hard-coded here. When a rule is missing the functions
 * return zero rather than guessing a statutory figure — a silent zero that the
 * caller reports as a warning is recoverable; an invented rate is not.
 */

import {
  EsiSplit,
  GenderApplicability,
  LwfResolution,
  LwfStateRuleRow,
  MinimumWageCheck,
  MinimumWageRuleRow,
  PfSplit,
  PtResolution,
  PtStateRuleRow,
  PtStateSlabRow,
  SkillLevel,
  StatutoryConfigRow,
} from '../types/compliance';
import { round2, toDateString } from './dateUtils';
import { num } from './payrollMath';

// ---------------------------------------------------------------------------
// Effective-dated configuration
// ---------------------------------------------------------------------------

/** A row carrying an effective window, which is every rule table here. */
interface EffectiveDated {
  effective_from: string;
  effective_to: string | null;
  is_active?: number | boolean;
}

function isActive(row: EffectiveDated): boolean {
  return row.is_active === undefined || row.is_active === true || row.is_active === 1;
}

/** True when `onDate` falls inside the row's effective window. */
function covers(row: EffectiveDated, onDate: string): boolean {
  const from = toDateString(row.effective_from);
  const to = row.effective_to ? toDateString(row.effective_to) : null;
  if (from && onDate < from) return false;
  if (to && onDate > to) return false;
  return true;
}

/**
 * Pick the row whose effective window covers `onDate`; the latest
 * `effective_from` wins when several do.
 *
 * Returns null rather than falling back to "any row" — applying next year's PF
 * ceiling to last year's payroll is exactly the kind of quiet error that only
 * shows up in an inspection.
 */
export function resolveConfig<T extends EffectiveDated & { scheme?: string }>(
  configs: T[],
  scheme: string,
  onDate: string,
): T | null {
  const date = toDateString(onDate);
  let best: T | null = null;
  for (const row of configs) {
    if (row.scheme !== undefined && row.scheme !== scheme) continue;
    if (!isActive(row)) continue;
    if (!covers(row, date)) continue;
    if (!best || toDateString(row.effective_from) > toDateString(best.effective_from)) best = row;
  }
  return best;
}

/** Same window logic for a state-scoped rule table. */
export function resolveStateRule<T extends EffectiveDated & { state_code: string }>(
  rules: T[],
  stateCode: string,
  onDate: string,
): T | null {
  const date = toDateString(onDate);
  const code = String(stateCode ?? '').toUpperCase();
  let best: T | null = null;
  for (const row of rules) {
    if (String(row.state_code ?? '').toUpperCase() !== code) continue;
    if (!isActive(row)) continue;
    if (!covers(row, date)) continue;
    if (!best || toDateString(row.effective_from) > toDateString(best.effective_from)) best = row;
  }
  return best;
}

/** `min(wage, ceiling)`, with a null/zero ceiling meaning "no ceiling". */
export function applyCeiling(wage: number, ceiling: number | null | undefined): number {
  const w = Math.max(0, num(wage));
  const c = ceiling === null || ceiling === undefined ? 0 : num(ceiling);
  if (c <= 0) return round2(w);
  return round2(Math.min(w, c));
}

// ---------------------------------------------------------------------------
// Provident fund
// ---------------------------------------------------------------------------

/**
 * Split a PF wage into the five amounts a challan needs.
 *
 * The employer's total contribution is split between the pension scheme and the
 * provident fund: `employerPf = employerTotal - eps`, never negative.
 *
 * There are two conventions in the wild for `statutory_config.employer_rate_pct`
 * on the PF row, and this deployment's seed uses the second:
 *
 *   a) the FULL employer rate (12%), from which EPS is then diverted;
 *   b) the rate NET of the diversion (3.67%), with EPS stated separately.
 *
 * Subtracting EPS in case (b) would produce a zero employer PF share and
 * under-remit the fund by 3.67% of wages every month — silently. So when the
 * configured employer total is smaller than the EPS diversion, the rate is
 * treated as already net of it, `employerPf` is the configured amount, and the
 * `employerRateIsNetOfEps` flag is raised so the caller can say so out loud.
 *
 * `adminCharges` is the straight percentage on this employee's wage. The
 * establishment-level MINIMUM administrative charge (`min_admin_charge`) is a
 * per-return floor, not a per-employee one, and is applied when the challan is
 * aggregated — applying it here would multiply it by the headcount.
 */
export function computePfSplit(
  wageBase: number,
  cfg: StatutoryConfigRow | null,
  epsCfg: StatutoryConfigRow | null,
  edliCfg: StatutoryConfigRow | null,
  vpfPercent = 0,
): PfSplit {
  const uncappedWage = round2(Math.max(0, num(wageBase)));
  const empty: PfSplit = {
    employeeShare: 0,
    vpfShare: 0,
    employerPf: 0,
    employerEps: 0,
    edli: 0,
    adminCharges: 0,
    totalWage: 0,
    epsWage: 0,
    edliWage: 0,
    uncappedWage,
    employerRateIsNetOfEps: false,
  };
  if (!cfg || uncappedWage <= 0) return empty;

  const totalWage = applyCeiling(uncappedWage, cfg.wage_ceiling);
  const employeeShare = round2((totalWage * num(cfg.employee_rate_pct)) / 100);
  const employerTotal = round2((totalWage * num(cfg.employer_rate_pct)) / 100);

  // --- pension diversion --------------------------------------------------
  let employerEps = 0;
  let epsWage = 0;
  if (epsCfg) {
    // EPS has its own ceiling: the diversion ceiling when set, otherwise the
    // scheme's own wage ceiling.
    const epsCeiling = epsCfg.diversion_ceiling ?? epsCfg.wage_ceiling;
    epsWage = applyCeiling(uncappedWage, epsCeiling);
    const epsRate = num(epsCfg.diversion_rate_pct) > 0
      ? num(epsCfg.diversion_rate_pct)
      : num(epsCfg.employer_rate_pct);
    employerEps = round2((epsWage * epsRate) / 100);
  }

  let employerPf: number;
  let employerRateIsNetOfEps = false;
  if (employerTotal >= employerEps) {
    employerPf = round2(employerTotal - employerEps);
  } else {
    employerPf = employerTotal;
    employerRateIsNetOfEps = true;
  }
  if (employerPf < 0) employerPf = 0;

  // --- EDLI ---------------------------------------------------------------
  let edli = 0;
  let edliWage = 0;
  if (edliCfg) {
    edliWage = applyCeiling(uncappedWage, edliCfg.wage_ceiling);
    edli = round2((edliWage * num(edliCfg.employer_rate_pct)) / 100);
  }

  // --- administration charge and VPF --------------------------------------
  const adminCharges = round2((totalWage * num(cfg.admin_charge_pct)) / 100);
  const vpf = Math.max(0, num(vpfPercent));
  const vpfShare = vpf > 0 ? round2((totalWage * vpf) / 100) : 0;

  return {
    employeeShare,
    vpfShare,
    employerPf,
    employerEps,
    edli,
    adminCharges,
    totalWage,
    epsWage,
    edliWage,
    uncappedWage,
    employerRateIsNetOfEps,
  };
}

// ---------------------------------------------------------------------------
// Employees' State Insurance
// ---------------------------------------------------------------------------

/**
 * ESI on gross wages.
 *
 * Both shares round UP to the next rupee, which is the ESIC convention and not
 * a rounding preference: contributions are always remitted in whole rupees and
 * a downward round would short the fund.
 *
 * An employee whose gross exceeds the ceiling is out of coverage for the month.
 * The statutory "continues until the end of the contribution period" rule for
 * someone who crosses the ceiling mid-period is NOT applied here: it needs the
 * contribution-period calendar (April-September / October-March) and the wage
 * history, and getting it wrong in either direction is a filing error. The
 * caller receives `covered: false` with a reason and can override.
 */
export function computeEsiSplit(
  gross: number,
  cfg: StatutoryConfigRow | null,
  isCovered: boolean,
): EsiSplit {
  const wage = round2(Math.max(0, num(gross)));
  if (!cfg) {
    return { employeeAmount: 0, employerAmount: 0, wageBase: wage, covered: false, reason: 'No ESI configuration is effective for this date' };
  }
  if (!isCovered) {
    return { employeeAmount: 0, employerAmount: 0, wageBase: wage, covered: false, reason: 'Employee is not enrolled in ESI' };
  }
  if (wage <= 0) {
    return { employeeAmount: 0, employerAmount: 0, wageBase: 0, covered: true, reason: null };
  }
  const ceiling = cfg.wage_ceiling === null || cfg.wage_ceiling === undefined ? 0 : num(cfg.wage_ceiling);
  if (ceiling > 0 && wage > ceiling) {
    return {
      employeeAmount: 0,
      employerAmount: 0,
      wageBase: wage,
      covered: false,
      reason: `Gross ${wage.toFixed(2)} exceeds the ESI wage ceiling of ${ceiling.toFixed(2)}`,
    };
  }
  return {
    employeeAmount: Math.ceil((wage * num(cfg.employee_rate_pct)) / 100),
    employerAmount: Math.ceil((wage * num(cfg.employer_rate_pct)) / 100),
    wageBase: wage,
    covered: true,
    reason: null,
  };
}

// ---------------------------------------------------------------------------
// Professional tax
// ---------------------------------------------------------------------------

function genderMatches(applicability: GenderApplicability, gender: string | null | undefined): boolean {
  if (!applicability || applicability === 'ALL') return true;
  if (!gender) return false;
  return String(gender).toUpperCase() === applicability;
}

/**
 * Professional tax for one employee-month.
 *
 * The state rule effective for the month is picked first, then its slabs are
 * walked ascending and the first band containing the monthly gross wins. A slab
 * may name a `special_month` (several states bill a larger instalment once a
 * year, typically February) and that amount replaces the normal one in exactly
 * that month.
 *
 * `month` is a `YYYY-MM` key; the rule is resolved as at the first of it.
 * The annual cap on the rule row is NOT enforced here — a cap spans twelve
 * months and this function only sees one, so the caller with the year-to-date
 * figure has to apply it.
 */
export function resolvePtAmount(
  rules: PtStateRuleRow[],
  slabs: PtStateSlabRow[],
  stateCode: string | null,
  monthlyGross: number,
  month: string,
  gender?: string | null,
): PtResolution {
  const none: PtResolution = { amount: 0, ruleId: null, slabId: null, stateCode: stateCode ?? null };
  if (!stateCode) return none;

  const onDate = `${String(month).slice(0, 7)}-01`;
  const rule = resolveStateRule(rules, stateCode, onDate);
  if (!rule) return none;
  if (!genderMatches(rule.gender_applicability, gender)) {
    return { amount: 0, ruleId: Number(rule.id), slabId: null, stateCode: rule.state_code };
  }

  const gross = round2(Math.max(0, num(monthlyGross)));
  const monthNumber = Number(String(month).slice(5, 7));

  const ruleSlabs = slabs
    .filter((s) => Number(s.rule_id) === Number(rule.id))
    .sort((a, b) => {
      const orderDiff = Number(a.slab_order) - Number(b.slab_order);
      return orderDiff !== 0 ? orderDiff : num(a.from_amount) - num(b.from_amount);
    });

  for (const slab of ruleSlabs) {
    const from = num(slab.from_amount);
    const to = slab.to_amount === null || slab.to_amount === undefined ? Number.POSITIVE_INFINITY : num(slab.to_amount);
    if (gross < from || gross > to) continue;

    const isSpecial = slab.special_month !== null
      && slab.special_month !== undefined
      && Number(slab.special_month) === monthNumber
      && slab.special_month_amount !== null
      && slab.special_month_amount !== undefined;

    const amount = isSpecial ? num(slab.special_month_amount) : num(slab.tax_amount);
    return { amount: round2(amount), ruleId: Number(rule.id), slabId: Number(slab.id), stateCode: rule.state_code };
  }

  return { amount: 0, ruleId: Number(rule.id), slabId: null, stateCode: rule.state_code };
}

// ---------------------------------------------------------------------------
// Labour welfare fund
// ---------------------------------------------------------------------------

/** Parse `deduction_months` ("6,12") into month numbers. */
function parseDeductionMonths(raw: string | null): number[] {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 12);
}

/**
 * Labour welfare fund for one employee-month.
 *
 * Most states collect this half-yearly, so the contribution is due only in the
 * months named on the rule. Outside those months the answer is a real zero, not
 * a missing rule, and `applicableThisMonth` says which of the two it was.
 *
 * When `deduction_months` is blank the rule is treated as monthly, matching the
 * `frequency` column's MONTHLY default.
 */
export function resolveLwfAmount(
  rules: LwfStateRuleRow[],
  stateCode: string | null,
  month: string,
): LwfResolution {
  const none: LwfResolution = {
    employeeAmount: 0,
    employerAmount: 0,
    ruleId: null,
    applicableThisMonth: false,
  };
  if (!stateCode) return none;

  const onDate = `${String(month).slice(0, 7)}-01`;
  const rule = resolveStateRule(rules, stateCode, onDate);
  if (!rule) return none;

  const monthNumber = Number(String(month).slice(5, 7));
  const months = parseDeductionMonths(rule.deduction_months);
  const applicable = months.length === 0 ? rule.frequency === 'MONTHLY' : months.includes(monthNumber);
  if (!applicable) {
    return { employeeAmount: 0, employerAmount: 0, ruleId: Number(rule.id), applicableThisMonth: false };
  }

  return {
    employeeAmount: round2(num(rule.employee_contribution)),
    employerAmount: round2(num(rule.employer_contribution)),
    ruleId: Number(rule.id),
    applicableThisMonth: true,
  };
}

// ---------------------------------------------------------------------------
// Minimum wage
// ---------------------------------------------------------------------------

/**
 * Compare a monthly gross against the notified floor for the state and skill
 * level. With no rule on record the answer is "compliant with a zero minimum" —
 * the checker must not manufacture a violation out of missing configuration.
 */
export function checkMinimumWage(
  rules: MinimumWageRuleRow[],
  stateCode: string | null,
  skillLevel: SkillLevel | string | null,
  monthlyGross: number,
): MinimumWageCheck {
  const none: MinimumWageCheck = { compliant: true, shortfall: 0, appliedMinimum: 0, ruleId: null };
  if (!stateCode || !skillLevel) return none;

  const code = String(stateCode).toUpperCase();
  const skill = String(skillLevel).toUpperCase();
  const candidates = rules.filter(
    (r) => String(r.state_code ?? '').toUpperCase() === code
      && String(r.skill_level ?? '').toUpperCase() === skill
      && isActive(r),
  );
  if (candidates.length === 0) return none;

  // The most recently notified floor applies.
  let rule = candidates[0] as MinimumWageRuleRow;
  for (const candidate of candidates) {
    if (toDateString(candidate.effective_from) > toDateString(rule.effective_from)) rule = candidate;
  }

  const minimum = round2(num(rule.monthly_minimum));
  const gross = round2(Math.max(0, num(monthlyGross)));
  const shortfall = round2(Math.max(0, minimum - gross));
  return {
    compliant: shortfall <= 0,
    shortfall,
    appliedMinimum: minimum,
    ruleId: Number(rule.id),
  };
}

// ---------------------------------------------------------------------------
// Gratuity
// ---------------------------------------------------------------------------

/**
 * Accrued gratuity liability for one employee.
 *
 *   provision = (last drawn wage x daysPerYear x countedYears) / denominator
 *
 * `daysPerYear`, `denominator`, the minimum qualifying service and the statutory
 * ceiling all come from the GRATUITY row of `statutory_config`; none is baked in
 * here. A part-year over six months rounds the service up, which is the rule in
 * section 4(2) of the Payment of Gratuity Act.
 *
 * `payrollMath.computeGratuity` implements the same formula against the fixed
 * statutory 15/26 basis and is what a final settlement uses. This variant exists
 * because a *provision* has to follow whatever basis the entity has configured,
 * including a more generous one, and has to honour the ceiling.
 */
export function computeGratuityProvision(
  lastDrawnWage: number,
  yearsOfService: number,
  cfg: StatutoryConfigRow | null,
): number {
  const wage = Math.max(0, num(lastDrawnWage));
  const years = Math.max(0, num(yearsOfService));
  if (!cfg || wage <= 0 || years <= 0) return 0;

  const minYears = num(cfg.gratuity_min_years);
  if (minYears > 0 && years < minYears) return 0;

  const daysPerYear = num(cfg.gratuity_days_per_year);
  const denominator = num(cfg.gratuity_denominator);
  if (daysPerYear <= 0 || denominator <= 0) return 0;

  const whole = Math.floor(years);
  const fraction = years - whole;
  const countedYears = fraction > 0.5 ? whole + 1 : whole;
  if (countedYears <= 0) return 0;

  const provision = (wage * daysPerYear * countedYears) / denominator;
  const cap = cfg.gratuity_max_amount === null || cfg.gratuity_max_amount === undefined
    ? 0
    : num(cfg.gratuity_max_amount);
  return round2(cap > 0 ? Math.min(provision, cap) : provision);
}

/** True when the employee has served long enough to qualify. */
export function isGratuityEligible(yearsOfService: number, cfg: StatutoryConfigRow | null): boolean {
  if (!cfg) return false;
  const minYears = num(cfg.gratuity_min_years);
  return num(yearsOfService) >= (minYears > 0 ? minYears : 0);
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/**
 * Due date for a return covering `monthKey`, filed `dueDay` of the FOLLOWING
 * month. The day is clamped to the length of that month, so "31" never becomes
 * an impossible 31 February.
 */
export function dueDateForMonth(monthKey: string, dueDay: number | null | undefined): string | null {
  const day = dueDay === null || dueDay === undefined ? 0 : Math.floor(num(dueDay));
  if (day <= 0) return null;
  const year = Number(String(monthKey).slice(0, 4));
  const month = Number(String(monthKey).slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const nextMonthIndex = month; // zero-based index of the month after `monthKey`
  const dueYear = year + Math.floor(nextMonthIndex / 12);
  const dueMonth = nextMonthIndex % 12;
  const lastDay = new Date(Date.UTC(dueYear, dueMonth + 1, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return `${dueYear}-${String(dueMonth + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

/** A UAN is exactly twelve digits; anything else cannot be filed in an ECR. */
export function isValidUan(uan: string | null | undefined): boolean {
  return !!uan && /^\d{12}$/.test(String(uan).trim());
}

/** PAN format: five letters, four digits, one letter. */
export function isValidPan(pan: string | null | undefined): boolean {
  return !!pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(pan).trim().toUpperCase());
}

/** Indian financial year for a date, formatted `2026-2027`. */
export function financialYearOf(date: string): string {
  const d = toDateString(date);
  const year = Number(d.slice(0, 4));
  const month = Number(d.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '';
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

/** First and last day of a `YYYY-YYYY` financial year. */
export function financialYearBounds(financialYear: string): { from: string; to: string } {
  const startYear = Number(String(financialYear).slice(0, 4));
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

/**
 * The `YYYY-MM` keys inside a financial-year quarter.
 * Q1 = April-June, Q2 = July-September, Q3 = October-December, Q4 = January-March.
 */
export function quarterMonths(financialYear: string, quarter: number): string[] {
  const startYear = Number(String(financialYear).slice(0, 4));
  const q = Math.floor(num(quarter));
  if (!Number.isFinite(startYear) || q < 1 || q > 4) return [];
  const months: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const monthIndex = 3 + (q - 1) * 3 + i; // April = index 3
    const year = startYear + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    months.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return months;
}
