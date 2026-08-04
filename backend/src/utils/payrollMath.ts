/**
 * Pure payroll arithmetic.
 *
 * Nothing here touches the database, the clock or any global state, so every
 * function is directly unit-testable and safe to call inside a tight per-employee
 * loop. Money is rounded to 2 decimals at each boundary rather than once at the
 * end, so a payslip's components always add up to its totals exactly.
 */

import { CalculationType, PercentBase, RoundingMode, LopBasis } from '../types/payroll';
import { round2 } from './dateUtils';

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

/** Division that yields 0 instead of Infinity/NaN when the divisor is unusable. */
export function safeDiv(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : 0;
}

/** `value` scaled by `numerator/denominator`, rounded to 2 decimals. */
export function proratePercent(value: number, numerator: number, denominator: number): number {
  if (!value) return 0;
  return round2(value * safeDiv(numerator, denominator));
}

/** Coerce anything mysql2 hands back (number | string | null) to a finite number. */
export function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Round a money value the way the pay cycle asks for.
 *
 * `precision` is the number of decimals kept (0 = whole rupees). NONE returns
 * the value untouched apart from a 2-decimal normalisation, so float noise never
 * leaks into the database.
 */
export function applyRounding(value: number, mode: RoundingMode, precision = 0): number {
  if (!Number.isFinite(value)) return 0;
  const p = Math.max(0, Math.min(6, Math.floor(precision)));
  const factor = Math.pow(10, p);
  switch (mode) {
    case 'NEAREST':
      return Math.round(value * factor) / factor;
    case 'UP':
      return Math.ceil(value * factor) / factor;
    case 'DOWN':
      return Math.floor(value * factor) / factor;
    case 'NONE':
    default:
      return round2(value);
  }
}

// ---------------------------------------------------------------------------
// Safe formula evaluation
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

function tokenise(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i] as string;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let j = i;
      let seenDot = false;
      while (j < expr.length) {
        const c = expr[j] as string;
        if (c >= '0' && c <= '9') {
          j += 1;
        } else if (c === '.' && !seenDot) {
          seenDot = true;
          j += 1;
        } else {
          break;
        }
      }
      tokens.push({ kind: 'number', value: Number(expr.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j] as string)) j += 1;
      tokens.push({ kind: 'ident', value: expr.slice(i, j).toUpperCase() });
      i = j;
      continue;
    }
    throw new Error(`Invalid character "${ch}" in formula at position ${i}`);
  }
  return tokens;
}

/**
 * Evaluate an admin-supplied arithmetic formula over named variables.
 *
 * Supports `+ - * / ( )`, decimal literals, unary minus and identifiers such as
 * BASIC, GROSS, CTC, DA, HRA. A formula string is *data*, never code: it is
 * tokenised and walked by a recursive-descent parser, so `eval` and
 * `new Function` are deliberately not used anywhere in this file.
 *
 * - unknown identifiers resolve to 0 (a structure referencing a component the
 *   employee does not have must not blow up payroll)
 * - division by zero yields 0
 * - anything the grammar cannot parse throws with the offending text
 */
export function evaluateFormula(expr: string, vars: Record<string, number> = {}): number {
  if (expr === null || expr === undefined || String(expr).trim() === '') return 0;
  const tokens = tokenise(String(expr));
  if (tokens.length === 0) return 0;

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];

  const parseExpression = (): number => {
    let left = parseTerm();
    for (;;) {
      const t = peek();
      if (t && t.kind === 'op' && (t.value === '+' || t.value === '-')) {
        pos += 1;
        const right = parseTerm();
        left = t.value === '+' ? left + right : left - right;
      } else {
        return left;
      }
    }
  };

  const parseTerm = (): number => {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t && t.kind === 'op' && (t.value === '*' || t.value === '/')) {
        pos += 1;
        const right = parseUnary();
        left = t.value === '*' ? left * right : safeDiv(left, right);
      } else {
        return left;
      }
    }
  };

  const parseUnary = (): number => {
    const t = peek();
    if (t && t.kind === 'op' && (t.value === '-' || t.value === '+')) {
      pos += 1;
      const value = parseUnary();
      return t.value === '-' ? -value : value;
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const t = peek();
    if (!t) throw new Error(`Formula "${expr}" ended unexpectedly`);
    if (t.kind === 'number') {
      pos += 1;
      return t.value;
    }
    if (t.kind === 'ident') {
      pos += 1;
      const value = vars[t.value];
      return Number.isFinite(value) ? (value as number) : 0;
    }
    if (t.kind === 'lparen') {
      pos += 1;
      const value = parseExpression();
      const closing = peek();
      if (!closing || closing.kind !== 'rparen') throw new Error(`Formula "${expr}" has an unclosed "("`);
      pos += 1;
      return value;
    }
    throw new Error(`Formula "${expr}" has an unexpected token at position ${pos}`);
  };

  const result = parseExpression();
  if (pos !== tokens.length) throw new Error(`Formula "${expr}" has trailing input after position ${pos}`);
  if (!Number.isFinite(result)) return 0;
  return result;
}

// ---------------------------------------------------------------------------
// Component resolution
// ---------------------------------------------------------------------------

export interface ComponentCalcContext {
  calculationType: CalculationType;
  /** Which base a PERCENT_OF component measures against. */
  percentOf?: PercentBase | null;
  /** Flat amount for FIXED (and the fallback for MANUAL/SLAB). */
  amount?: number | null;
  percentValue?: number | null;
  formula?: string | null;
  /** Named variables offered to FORMULA components. */
  vars?: Record<string, number>;
  /** Full-month bases the percentages are measured against. */
  bases?: Partial<Record<PercentBase, number>>;
  /** Externally supplied figure for PIECE_RATE / ATTENDANCE_BASED / MANUAL / SLAB. */
  suppliedAmount?: number | null;
  /** Proration: the component is scaled by payableDays/denominatorDays. */
  isProrated?: boolean;
  payableDays?: number;
  denominatorDays?: number;
  minAmount?: number | null;
  maxAmount?: number | null;
  roundingMode?: RoundingMode;
  roundingPrecision?: number;
}

export interface ComponentAmount {
  amount: number;
  baseAmount: number | null;
  percentApplied: number | null;
}

/**
 * Evaluate a single pay component into a rupee amount.
 *
 * Proration is applied *after* the component's own arithmetic and only when the
 * component is flagged prorated, so a percentage of BASIC is never prorated
 * twice (BASIC itself is prorated, and the percentage is taken on the full-month
 * base then scaled once).
 */
export function resolveComponentAmount(ctx: ComponentCalcContext): ComponentAmount {
  let baseAmount: number | null = null;
  let percentApplied: number | null = null;
  let raw = 0;

  switch (ctx.calculationType) {
    case 'FIXED':
      raw = num(ctx.amount);
      break;

    case 'PERCENT_OF': {
      const base = ctx.percentOf ? num(ctx.bases?.[ctx.percentOf]) : 0;
      const pct = num(ctx.percentValue);
      baseAmount = round2(base);
      percentApplied = pct;
      raw = (base * pct) / 100;
      break;
    }

    case 'FORMULA': {
      const vars: Record<string, number> = { ...(ctx.vars ?? {}) };
      for (const [key, value] of Object.entries(ctx.bases ?? {})) {
        if (vars[key] === undefined) vars[key] = num(value);
      }
      raw = evaluateFormula(ctx.formula ?? '', vars);
      break;
    }

    case 'PIECE_RATE':
      // Piece-rate earnings come from delivered lots, never from a structure.
      raw = num(ctx.suppliedAmount);
      break;

    case 'ATTENDANCE_BASED':
      // Overtime, LWP and friends: the engine hands in the attendance-derived
      // figure; the component definition only decides how it is presented.
      raw = num(ctx.suppliedAmount);
      break;

    case 'SLAB':
    case 'MANUAL':
    default:
      raw = ctx.suppliedAmount !== undefined && ctx.suppliedAmount !== null
        ? num(ctx.suppliedAmount)
        : num(ctx.amount);
      break;
  }

  if (ctx.isProrated) {
    raw = raw * safeDiv(num(ctx.payableDays), num(ctx.denominatorDays));
  }

  let value = round2(raw);
  if (ctx.minAmount !== null && ctx.minAmount !== undefined && value < num(ctx.minAmount)) {
    value = round2(num(ctx.minAmount));
  }
  if (ctx.maxAmount !== null && ctx.maxAmount !== undefined && value > num(ctx.maxAmount)) {
    value = round2(num(ctx.maxAmount));
  }
  if (ctx.roundingMode && ctx.roundingMode !== 'NONE') {
    value = applyRounding(value, ctx.roundingMode, ctx.roundingPrecision ?? 0);
  }

  return { amount: round2(value), baseAmount, percentApplied };
}

// ---------------------------------------------------------------------------
// Attendance-driven days
// ---------------------------------------------------------------------------

export interface PayableDaysInput {
  /** Full length of the payroll window in days. */
  periodDays: number;
  /** Days the attendance walk marked as paid (PRESENT/HOLIDAY/paid leave/…). */
  paidUnits: number;
  /** Days in the window that are neither a holiday nor a weekly off. */
  workingDays: number;
  lopBasis: LopBasis;
  fixedDaysPerMonth?: number | null;
}

export interface PayableDaysResult {
  lopDays: number;
  payableDays: number;
  /** The denominator a monthly salary is divided by. */
  denominatorDays: number;
}

/**
 * Loss-of-pay days: every day of the window the employee was not paid for.
 *
 * Days before joining or after resigning count as LOP for proration purposes —
 * that is exactly what makes a mid-month joiner receive a part month.
 */
export function computeLopDays(periodDays: number, paidUnits: number): number {
  return round2(Math.max(0, num(periodDays) - num(paidUnits)));
}

/**
 * Payable days and the denominator behind them, honouring the cycle's LOP basis.
 *
 * - CALENDAR_DAYS: denominator is the length of the window (per-day pay changes
 *   with month length, the default Indian practice)
 * - WORKING_DAYS:  denominator excludes holidays and weekly offs
 * - FIXED_DAYS:    denominator is the configured constant (typically 26)
 *
 * `payableDays = denominator - lopDays`, clamped into [0, denominator]: an
 * employee can never be paid for more than a full cycle.
 */
export function computePayableDays(input: PayableDaysInput): PayableDaysResult {
  const periodDays = Math.max(0, num(input.periodDays));
  const lopDays = computeLopDays(periodDays, input.paidUnits);

  let denominator: number;
  switch (input.lopBasis) {
    case 'WORKING_DAYS':
      denominator = num(input.workingDays) > 0 ? num(input.workingDays) : periodDays;
      break;
    case 'FIXED_DAYS':
      denominator = num(input.fixedDaysPerMonth) > 0 ? num(input.fixedDaysPerMonth) : 26;
      break;
    case 'CALENDAR_DAYS':
    default:
      denominator = periodDays;
      break;
  }

  const payableDays = round2(Math.max(0, Math.min(denominator, denominator - lopDays)));
  return { lopDays, payableDays, denominatorDays: round2(denominator) };
}

// ---------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------

/**
 * Standard reducing-balance EMI.
 *
 * A 0% loan degrades to a straight principal/tenure split, which is how staff
 * loans are usually granted here.
 */
export function computeEmi(principal: number, annualRatePct: number, tenureMonths: number): number {
  const p = num(principal);
  const n = Math.floor(num(tenureMonths));
  if (p <= 0 || n <= 0) return 0;

  const monthlyRate = num(annualRatePct) / 12 / 100;
  if (monthlyRate <= 0) return round2(p / n);

  const growth = Math.pow(1 + monthlyRate, n);
  const emi = (p * monthlyRate * growth) / (growth - 1);
  return Number.isFinite(emi) ? round2(emi) : round2(p / n);
}

export interface AmortisationRow {
  seq: number;
  /** Due date of the installment; null when no first due date was supplied. */
  dueDate: string;
  emiAmount: number;
  principalComponent: number;
  interestComponent: number;
  outstandingAfter: number;
}

/**
 * Add whole months to a `YYYY-MM-DD` date, clamping to the end of a short month
 * (31 Jan + 1 month = 28/29 Feb) so a schedule never skips a month.
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(date).slice(0, 10);
  const targetMonthIndex = (m as number) - 1 + Math.floor(months);
  const year = (y as number) + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d as number, lastDay);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Full amortisation schedule.
 *
 * The last installment absorbs every rounding difference, so the principal
 * components sum to exactly the principal and the final outstanding is exactly
 * zero — no loan ever ends a rupee short or a rupee over.
 *
 * `firstDueDate` (optional) seeds monthly due dates for each installment.
 */
export function buildAmortisationSchedule(
  principal: number,
  annualRatePct: number,
  tenureMonths: number,
  firstDueDate?: string,
  emiOverride?: number,
): AmortisationRow[] {
  const p = round2(num(principal));
  const n = Math.floor(num(tenureMonths));
  if (p <= 0 || n <= 0) return [];

  const monthlyRate = num(annualRatePct) / 12 / 100;
  const emi = num(emiOverride) > 0 ? round2(num(emiOverride)) : computeEmi(p, annualRatePct, n);

  const rows: AmortisationRow[] = [];
  let outstanding = p;
  const seed = firstDueDate ? String(firstDueDate).slice(0, 10) : '';
  const dueDateFor = (seq: number): string => (seed ? addMonths(seed, seq - 1) : '');

  for (let seq = 1; seq <= n; seq += 1) {
    const isLast = seq === n;
    if (isLast) {
      // Everything still outstanding is settled here, interest included, so the
      // schedule reconciles to the rupee.
      const interest = monthlyRate > 0 ? round2(outstanding * monthlyRate) : 0;
      const principalPart = round2(outstanding);
      rows.push({
        seq,
        dueDate: dueDateFor(seq),
        emiAmount: round2(principalPart + interest),
        principalComponent: principalPart,
        interestComponent: interest,
        outstandingAfter: 0,
      });
      outstanding = 0;
      break;
    }

    const interest = monthlyRate > 0 ? round2(outstanding * monthlyRate) : 0;
    let principalPart = round2(emi - interest);
    if (principalPart < 0) principalPart = 0;
    if (principalPart > outstanding) principalPart = outstanding;
    outstanding = round2(outstanding - principalPart);
    rows.push({
      seq,
      dueDate: dueDateFor(seq),
      emiAmount: round2(principalPart + interest),
      principalComponent: principalPart,
      interestComponent: interest,
      outstandingAfter: outstanding,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Gratuity
// ---------------------------------------------------------------------------

/**
 * Gratuity under the Payment of Gratuity Act, 1972.
 *
 *   gratuity = last drawn (basic + DA) x 15/26 x completed years of service
 *
 * Rules encoded here:
 *  - a part-year of more than 6 months rounds the service *up* to the next year
 *    (4 years 7 months counts as 5)
 *  - nothing is payable below 5 years of continuous service; the statutory
 *    exceptions for death or permanent disablement are a policy decision and are
 *    NOT applied automatically — the caller passes the years it wants counted
 *  - 26 is the statutory number of working days in a month, not a config value
 */
export function computeGratuity(lastDrawnBasicPlusDa: number, yearsOfService: number): number {
  const wage = num(lastDrawnBasicPlusDa);
  const years = num(yearsOfService);
  if (wage <= 0 || years <= 0) return 0;
  if (years < 5) return 0;

  const whole = Math.floor(years);
  const fraction = years - whole;
  const countedYears = fraction > 0.5 ? whole + 1 : whole;

  return round2((wage * 15 * countedYears) / 26);
}

/** Completed years between two dates, as a fraction (365.25-day year). */
export function yearsOfService(fromDate: string, toDate: string): number {
  const start = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round(((end - start) / 86400000 / 365.25) * 100) / 100;
}
