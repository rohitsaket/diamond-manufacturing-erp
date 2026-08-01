import { StatutoryConfig } from '../types/hrms';
import { round2 } from './dateUtils';

/**
 * Indian statutory deduction math (employee share only).
 *
 * Gross pay is used as the contribution base. A full salary structure with a
 * separate basic/HRA split does not exist in this system, so "basic" and
 * "gross" are the same figure here — documented on the payslip.
 */

const DEFAULT_PT_SLABS = [
  { upTo: 11999, amount: 0 },
  { upTo: 24999, amount: 150 },
  { upTo: null, amount: 200 },
];

/** Parse raw settings key/value pairs into a typed statutory config. */
export function parseStatutoryConfig(settings: Record<string, string>): StatutoryConfig {
  const num = (key: string, fallback: number): number => {
    const raw = settings[key];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const raw = settings[key];
    if (raw === undefined) return fallback;
    return raw === 'true' || raw === '1';
  };

  let ptSlabs = DEFAULT_PT_SLABS;
  const rawSlabs = settings['pt_slabs_json'];
  if (rawSlabs) {
    try {
      const parsed = JSON.parse(rawSlabs);
      if (Array.isArray(parsed) && parsed.length > 0) {
        ptSlabs = parsed.map((s: any) => ({
          upTo: s.upTo === null || s.upTo === undefined ? null : Number(s.upTo),
          amount: Number(s.amount) || 0,
        }));
      }
    } catch {
      throw new Error('Setting pt_slabs_json is not valid JSON. Expected [{"upTo":11999,"amount":0}, ...]');
    }
  }

  return {
    pfEnabled: bool('pf_enabled', true),
    pfRatePct: num('pf_employee_rate_pct', 12),
    pfCeiling: num('pf_wage_ceiling', 15000),
    esiEnabled: bool('esi_enabled', true),
    esiRatePct: num('esi_employee_rate_pct', 0.75),
    esiCeiling: num('esi_gross_ceiling', 21000),
    ptEnabled: bool('pt_enabled', true),
    ptSlabs,
    otRatePerHour: num('ot_rate_per_hour', 60),
    fullDayHours: num('attendance_full_day_hours', 7),
    halfDayHours: num('attendance_half_day_hours', 4),
    otMinMinutes: num('ot_min_minutes', 30),
  };
}

/** Employee PF: 12% of min(gross, ceiling). */
export function computePf(gross: number, cfg: StatutoryConfig, applicable: boolean): number {
  if (!applicable || !cfg.pfEnabled || gross <= 0) return 0;
  const base = Math.min(gross, cfg.pfCeiling);
  return round2((base * cfg.pfRatePct) / 100);
}

/** Employee ESI: 0.75% of gross, only when gross is within the ceiling. Rounds up to the rupee. */
export function computeEsi(gross: number, cfg: StatutoryConfig, applicable: boolean): number {
  if (!applicable || !cfg.esiEnabled || gross <= 0) return 0;
  if (gross > cfg.esiCeiling) return 0;
  return Math.ceil((gross * cfg.esiRatePct) / 100);
}

/** Professional tax: first matching slab wins; slabs must be ordered ascending. */
export function computePt(gross: number, cfg: StatutoryConfig): number {
  if (!cfg.ptEnabled || gross <= 0) return 0;
  for (const slab of cfg.ptSlabs) {
    if (slab.upTo === null || gross <= slab.upTo) return round2(slab.amount);
  }
  return 0;
}

/**
 * Prorate a monthly salary across a period that may span parts of several months.
 *
 * Each month's paid days are divided by that month's own length, so a
 * 16-Jul..15-Aug period charges July days at /31 and August days at /31.
 */
export function prorateMonthly(
  monthlySalary: number,
  paidUnitsByMonth: Map<string, number>,
  daysInMonthFn: (month: string) => number,
): number {
  if (!monthlySalary || monthlySalary <= 0) return 0;
  let total = 0;
  for (const [month, units] of paidUnitsByMonth) {
    const dim = daysInMonthFn(month);
    if (dim > 0) total += units * (monthlySalary / dim);
  }
  return round2(total);
}

/** Overtime pay from hours and the configured flat hourly rate. */
export function computeOtAmount(otHours: number, cfg: StatutoryConfig): number {
  if (!otHours || otHours <= 0) return 0;
  return round2(otHours * cfg.otRatePerHour);
}
