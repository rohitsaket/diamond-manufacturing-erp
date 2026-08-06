import { BaseRepository } from '../repositories/BaseRepository';
import { EligibilityCheck, EligibilityRules } from '../types/internalRecruitment';

/** Appraisal states whose final_rating is a settled, citable number. */
const SETTLED_APPRAISAL_STATUSES = ['FINALIZED', 'LETTER_ISSUED', 'ACKNOWLEDGED'];

const RULE_KEYS: (keyof EligibilityRules)[] = [
  'minTenureMonths',
  'allowedGrades',
  'minPerformanceRating',
  'requiredSkills',
  'requiredCertifications',
  'maxNoticeDays',
];

class EligibilityRepository extends BaseRepository {
  async findEmployee(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT id, emp_code, full_name, grade, joined_at, department_id FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  async skillNames(employeeId: number): Promise<string[]> {
    const rows = await this.query<any[]>(
      `SELECT s.name FROM employee_skills es
         JOIN skills s ON s.id = es.skill_id AND s.deleted_at IS NULL
        WHERE es.employee_id = ?`,
      [employeeId],
    );
    return rows.map((r) => String(r.name));
  }

  async certificationNames(employeeId: number): Promise<string[]> {
    const rows = await this.query<any[]>(
      'SELECT name FROM employee_certifications WHERE employee_id = ? AND deleted_at IS NULL',
      [employeeId],
    );
    return rows.map((r) => String(r.name));
  }

  /** Latest settled appraisal rating, or null when none exists. */
  async latestFinalRating(employeeId: number): Promise<number | null> {
    const rows = await this.query<any[]>(
      `SELECT final_rating FROM appraisals
        WHERE employee_id = ? AND deleted_at IS NULL AND final_rating IS NOT NULL
          AND status IN (${SETTLED_APPRAISAL_STATUSES.map(() => '?').join(', ')})
        ORDER BY id DESC LIMIT 1`,
      [employeeId, ...SETTLED_APPRAISAL_STATUSES],
    );
    return rows.length ? Number(rows[0].final_rating) : null;
  }
}

/** Everything the rules are evaluated against, gathered once per applicant. */
export interface ApplicantProfile {
  employeeId: number;
  grade: string | null;
  tenureMonths: number | null;
  skills: string[];
  certifications: string[];
  latestRating: number | null;
}

export interface EligibilityOutcome {
  checks: EligibilityCheck[];
  /** True when no rule evaluated to a hard fail. pass:null rules warn only. */
  passed: boolean;
}

function normalise(s: string): string {
  return s.trim().toLowerCase();
}

/** Whole months elapsed since a joining date (UTC, floor). */
export function monthsSince(joinedAt: Date | string, now = new Date()): number {
  const start = joinedAt instanceof Date ? joinedAt : new Date(`${String(joinedAt).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return 0;
  let months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Evaluates a job's EligibilityRules against a real employee profile.
 *
 * Contract (src/types/internalRecruitment.ts): pass=true/false are real
 * evaluations against recorded data; pass=null means the rule COULD NOT be
 * evaluated (e.g. no settled appraisal exists) - it warns but never blocks,
 * and it is never converted into a fabricated pass.
 */
export class EligibilityService {
  private repo = new EligibilityRepository();

  /** Validates a rules object's shape; throws with a staff-facing message. */
  validateRules(rules: any): EligibilityRules | null {
    if (rules === null || rules === undefined) return null;
    if (typeof rules !== 'object' || Array.isArray(rules)) {
      throw new Error('eligibilityRules must be an object');
    }
    const unknown = Object.keys(rules).filter((k) => !RULE_KEYS.includes(k as keyof EligibilityRules));
    if (unknown.length) {
      throw new Error(`Unknown eligibilityRules keys: ${unknown.join(', ')}. Allowed: ${RULE_KEYS.join(', ')}`);
    }
    const out: EligibilityRules = {};
    for (const key of ['minTenureMonths', 'minPerformanceRating', 'maxNoticeDays'] as const) {
      const v = rules[key];
      if (v === undefined || v === null) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number or null`);
      out[key] = n;
    }
    for (const key of ['allowedGrades', 'requiredSkills', 'requiredCertifications'] as const) {
      const v = rules[key];
      if (v === undefined || v === null) continue;
      if (!Array.isArray(v) || v.some((x: any) => typeof x !== 'string')) {
        throw new Error(`${key} must be an array of strings`);
      }
      out[key] = v.map((x: string) => x.trim()).filter((x: string) => x.length > 0);
    }
    return out;
  }

  /** Gathers the honest inputs once; also used for the profile snapshot. */
  async buildProfile(employeeId: number): Promise<ApplicantProfile> {
    const employee = await this.repo.findEmployee(employeeId);
    if (!employee) throw new Error('Employee not found');
    const [skills, certifications, latestRating] = await Promise.all([
      this.repo.skillNames(employeeId),
      this.repo.certificationNames(employeeId),
      this.repo.latestFinalRating(employeeId),
    ]);
    return {
      employeeId,
      grade: employee.grade ? String(employee.grade) : null,
      tenureMonths: employee.joined_at ? monthsSince(employee.joined_at) : null,
      skills,
      certifications,
      latestRating,
    };
  }

  /** Pure evaluation: no I/O, so the same result can be stored and replayed. */
  evaluate(
    rules: EligibilityRules | null,
    profile: ApplicantProfile,
    expectedNoticeDays: number | null,
  ): EligibilityOutcome {
    const checks: EligibilityCheck[] = [];
    if (!rules) return { checks, passed: true };

    if (rules.minTenureMonths !== undefined && rules.minTenureMonths !== null) {
      const min = Number(rules.minTenureMonths);
      if (profile.tenureMonths === null) {
        checks.push({ rule: 'minTenureMonths', pass: null, detail: `No joining date on record - could not evaluate the ${min}-month tenure requirement` });
      } else {
        checks.push({
          rule: 'minTenureMonths',
          pass: profile.tenureMonths >= min,
          detail: `${profile.tenureMonths} months of service against a ${min}-month requirement`,
        });
      }
    }

    if (rules.allowedGrades && rules.allowedGrades.length > 0) {
      if (!profile.grade) {
        checks.push({ rule: 'allowedGrades', pass: null, detail: 'No grade on the employee record - could not evaluate the grade requirement' });
      } else {
        const allowed = rules.allowedGrades.map(normalise);
        const inList = allowed.includes(normalise(profile.grade));
        checks.push({
          rule: 'allowedGrades',
          pass: inList,
          detail: inList
            ? `Grade ${profile.grade} is in the allowed list`
            : `Grade ${profile.grade} is not in the allowed list (${rules.allowedGrades.join(', ')})`,
        });
      }
    }

    if (rules.minPerformanceRating !== undefined && rules.minPerformanceRating !== null) {
      const min = Number(rules.minPerformanceRating);
      if (profile.latestRating === null) {
        checks.push({ rule: 'minPerformanceRating', pass: null, detail: `No finalized appraisal rating on record - could not evaluate the ${min} rating requirement` });
      } else {
        checks.push({
          rule: 'minPerformanceRating',
          pass: profile.latestRating >= min,
          detail: `Final rating ${profile.latestRating} against a ${min} requirement`,
        });
      }
    }

    if (rules.requiredSkills && rules.requiredSkills.length > 0) {
      const have = new Set(profile.skills.map(normalise));
      const missing = rules.requiredSkills.filter((s) => !have.has(normalise(s)));
      checks.push({
        rule: 'requiredSkills',
        pass: missing.length === 0,
        detail:
          missing.length === 0
            ? `${rules.requiredSkills.join(', ')} recorded in the skills profile`
            : `Missing from the skills profile: ${missing.join(', ')}${profile.skills.length === 0 ? ' (no skills recorded at all)' : ''}`,
      });
    }

    if (rules.requiredCertifications && rules.requiredCertifications.length > 0) {
      const have = new Set(profile.certifications.map(normalise));
      const missing = rules.requiredCertifications.filter((c) => !have.has(normalise(c)));
      checks.push({
        rule: 'requiredCertifications',
        pass: missing.length === 0,
        detail:
          missing.length === 0
            ? `${rules.requiredCertifications.join(', ')} recorded in the certifications profile`
            : `Missing certifications: ${missing.join(', ')}${profile.certifications.length === 0 ? ' (none recorded at all)' : ''}`,
      });
    }

    if (rules.maxNoticeDays !== undefined && rules.maxNoticeDays !== null) {
      const max = Number(rules.maxNoticeDays);
      if (expectedNoticeDays === null || expectedNoticeDays === undefined) {
        checks.push({ rule: 'maxNoticeDays', pass: null, detail: `No expected notice period stated - could not evaluate against the ${max}-day limit` });
      } else {
        checks.push({
          rule: 'maxNoticeDays',
          pass: expectedNoticeDays <= max,
          detail: `${expectedNoticeDays} days expected against a ${max}-day limit`,
        });
      }
    }

    return { checks, passed: checks.every((c) => c.pass !== false) };
  }

  /** Convenience: profile + evaluation in one call. */
  async evaluateForEmployee(
    rules: EligibilityRules | null,
    employeeId: number,
    expectedNoticeDays: number | null,
  ): Promise<EligibilityOutcome & { profile: ApplicantProfile }> {
    const profile = await this.buildProfile(employeeId);
    return { ...this.evaluate(rules, profile, expectedNoticeDays), profile };
  }
}
