import {
  CheckResultResponse,
  CheckResultValue,
  ChecklistItemResponse,
  ComplianceRepository,
  DEFAULT_SKILL_LEVEL,
  FindingSeverity,
  GRADE_SKILL_MAP,
  RuleSample,
  SEVERITY_WEIGHT,
} from '../repositories/ComplianceRepository';
import { todayString } from '../utils/dateUtils';

export interface RunChecksInput {
  periodId?: number;
  financialYear?: string;
  auditId?: number;
}

export interface CheckRunSummary {
  financialYear: string;
  periodId: number | null;
  auditId: number | null;
  checkedAt: string;
  evaluated: number;
  passed: number;
  failed: number;
  warnings: number;
  notApplicable: number;
  unimplemented: string[];
  resultIds: number[];
  results: CheckResultResponse[];
  score: ComplianceScore;
}

export interface ComplianceScoreBreakdown {
  code: string;
  title: string;
  category: string;
  severity: FindingSeverity;
  ruleCode: string | null;
  result: CheckResultValue;
  affectedCount: number;
  weight: number;
  creditEarned: number;
}

export interface ComplianceScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  passed: number;
  failed: number;
  warnings: number;
  evaluated: number;
  breakdown: ComplianceScoreBreakdown[];
  weighting: {
    weights: Record<FindingSeverity, number>;
    explanation: string;
    gradeBands: string;
  };
}

export interface RaiseFindingsResult {
  raised: { findingId: number; resultId: number; ruleCode: string; title: string }[];
  skipped: { resultId: number; ruleCode: string | null; reason: string }[];
}

const WEIGHTING_EXPLANATION =
  'Each checklist item contributes its severity weight (LOW 1, MEDIUM 2, HIGH 4, CRITICAL 8), so one '
  + 'CRITICAL failure costs exactly four times a MEDIUM one. A PASS earns full credit, a WARNING earns '
  + 'half, and a FAIL earns none. The score is the credit earned as a percentage of the credit available; '
  + 'items that could not be evaluated are excluded from both sides rather than counted as passes.';

const GRADE_BANDS = 'A at 90 or above, B at 75, C at 60, D below 60.';

/** Rules whose breach is expected rather than wrong, so never a hard failure. */
const ADVISORY_RULES = new Set(['ESI_ELIGIBILITY']);

function fyBounds(financialYear: string): { from: string; to: string } {
  const start = Number(String(financialYear).slice(0, 4));
  if (!Number.isFinite(start)) throw new Error("Financial year must look like '2026-2027'");
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

function currentFinancialYear(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function describeSample(sample: RuleSample[]): string {
  const labels = sample
    .slice(0, 5)
    .map((s) => s.empCode ?? s.reference ?? (s.employeeId ?? s.recordId ? `#${s.employeeId ?? s.recordId}` : null))
    .filter((s): s is string => !!s);
  return labels.length ? ` First affected: ${labels.join(', ')}.` : '';
}

/**
 * The automated compliance checker.
 *
 * Every rule is one set-based SQL statement evaluated in the repository, so a
 * run costs a fixed handful of queries no matter whether the company has ten
 * employees or a hundred thousand. Results store a capped evidence sample --
 * at most fifty offending records -- because a compliance table that grows with
 * the size of the breach becomes unusable exactly when it matters most.
 *
 * What it cannot do is judge intent. It reports what the data says, with the
 * assumptions it had to make written into the result, and leaves the finding to
 * a person.
 */
export class ComplianceCheckService {
  private repo = new ComplianceRepository();

  async runChecks(input: RunChecksInput, userId: number): Promise<CheckRunSummary> {
    const financialYear = this.normaliseFy(input.financialYear ?? currentFinancialYear());
    const bounds = fyBounds(financialYear);
    const periodId = input.periodId && Number.isFinite(input.periodId) ? Math.floor(input.periodId) : null;
    const auditId = input.auditId && Number.isFinite(input.auditId) ? Math.floor(input.auditId) : null;
    const today = todayString();

    const items = await this.repo.listChecklistItems({ isAutomated: true, isActive: true, limit: 300 });
    const resultIds: number[] = [];
    const unimplemented: string[] = [];
    let passed = 0;
    let failed = 0;
    let warnings = 0;
    let notApplicable = 0;

    for (const item of items) {
      if (!item.ruleCode) {
        unimplemented.push(item.code);
        continue;
      }

      const evaluation = await this.repo.evaluateRule(item.ruleCode, {
        financialYear,
        fyFrom: bounds.from,
        fyTo: bounds.to,
        periodId,
        today,
      });

      const notes = [...evaluation.notes];
      if (item.ruleCode === 'BELOW_MINIMUM_WAGE') notes.unshift(this.gradeMappingNote());

      const result = this.resolveResult(item, evaluation.affectedCount);
      const detail = this.buildDetail(item, result, evaluation.affectedCount, evaluation.sample, notes);

      const id = await this.repo.insertCheckResult({
        checklistItemId: item.id,
        auditId,
        periodId,
        financialYear,
        result,
        affectedCount: evaluation.affectedCount,
        detail,
        evidence: evaluation.sample,
        checkedBy: userId,
      });
      resultIds.push(id);

      if (result === 'PASS') passed++;
      else if (result === 'FAIL') failed++;
      else if (result === 'WARNING') warnings++;
      else notApplicable++;
    }

    await this.repo.logAudit({
      entityType: 'compliance_check_results',
      action: 'RUN_CHECKS',
      summary: `Ran ${resultIds.length} automated compliance checks for ${financialYear}: `
        + `${passed} passed, ${failed} failed, ${warnings} warnings`,
      actorUserId: userId,
    });

    const results = await this.repo.findResultsByIds(resultIds);
    return {
      financialYear,
      periodId,
      auditId,
      checkedAt: new Date().toISOString(),
      evaluated: resultIds.length,
      passed,
      failed,
      warnings,
      notApplicable,
      unimplemented,
      resultIds,
      results,
      score: this.scoreFrom(results),
    };
  }

  /**
   * A FAIL earns a finding unless the same rule already has one open. Raising a
   * second finding for a breach somebody is already working on just buries the
   * first one.
   */
  async autoRaiseFindings(resultIds: number[], userId: number): Promise<RaiseFindingsResult> {
    const ids = (Array.isArray(resultIds) ? resultIds : [])
      .map((id) => Math.floor(Number(id)))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) throw new Error('At least one check result id is required');

    const results = await this.repo.findResultsByIds(ids);
    const raised: RaiseFindingsResult['raised'] = [];
    const skipped: RaiseFindingsResult['skipped'] = [];

    const failing = results.filter((r) => r.result === 'FAIL');
    for (const result of results) {
      if (result.result !== 'FAIL') {
        skipped.push({ resultId: result.id, ruleCode: result.ruleCode, reason: `Result is ${result.result}, not a failure` });
      }
    }

    const ruleCodes = failing.map((r) => r.ruleCode).filter((c): c is string => !!c);
    const alreadyOpen = await this.repo.findOpenRuleCodes(ruleCodes);

    for (const result of failing) {
      if (!result.ruleCode) {
        skipped.push({ resultId: result.id, ruleCode: null, reason: 'The checklist item has no rule code to de-duplicate on' });
        continue;
      }
      const open = alreadyOpen.get(result.ruleCode);
      if (open) {
        skipped.push({
          resultId: result.id,
          ruleCode: result.ruleCode,
          reason: `Finding #${open} for ${result.ruleCode} is already open`,
        });
        continue;
      }

      const findingId = await this.repo.createFinding(
        {
          auditId: result.auditId,
          category: result.category,
          severity: result.severity,
          title: result.title,
          description: result.detail,
          affectedCount: result.affectedCount,
          ruleCode: result.ruleCode,
          isAutomated: true,
          status: 'OPEN',
          identifiedOn: todayString(),
        },
        userId,
      );
      await this.repo.linkResultToFinding(result.id, findingId);
      alreadyOpen.set(result.ruleCode, findingId);
      raised.push({ findingId, resultId: result.id, ruleCode: result.ruleCode, title: result.title });

      await this.repo.logAudit({
        entityType: 'compliance_findings',
        entityId: findingId,
        action: 'AUTO_RAISE',
        summary: `Automated finding raised for ${result.ruleCode}: ${result.affectedCount} affected`,
        actorUserId: userId,
      });
    }

    return { raised, skipped };
  }

  async getLatestResults(filters: { financialYear?: string; periodId?: number } = {}): Promise<CheckResultResponse[]> {
    const fy = filters.financialYear ? this.normaliseFy(filters.financialYear) : undefined;
    return this.repo.listLatestCheckResults({ financialYear: fy, periodId: filters.periodId });
  }

  async listResults(filters: {
    financialYear?: string;
    periodId?: number;
    auditId?: number;
    result?: string;
    ruleCode?: string;
    limit?: number;
  } = {}): Promise<CheckResultResponse[]> {
    const fy = filters.financialYear ? this.normaliseFy(filters.financialYear) : undefined;
    return this.repo.listCheckResults({ ...filters, financialYear: fy });
  }

  async getComplianceScore(financialYear: string): Promise<ComplianceScore> {
    const fy = this.normaliseFy(financialYear);
    const results = await this.repo.listLatestCheckResults({ financialYear: fy });
    return this.scoreFrom(results);
  }

  // -------------------------------------------------------------------------
  // Checklist item maintenance
  // -------------------------------------------------------------------------

  async listItems(filters: { category?: string; isAutomated?: boolean; isActive?: boolean } = {}): Promise<ChecklistItemResponse[]> {
    return this.repo.listChecklistItems(filters);
  }

  async createItem(data: Record<string, any>): Promise<ChecklistItemResponse> {
    if (!data.code || !data.title || !data.category) {
      throw new Error('A checklist item needs a code, a title and a category');
    }
    const id = await this.repo.createChecklistItem(data);
    const item = await this.repo.findChecklistItemById(id);
    if (!item) throw new Error('Checklist item could not be created');
    return item;
  }

  async updateItem(id: number, data: Record<string, any>): Promise<ChecklistItemResponse> {
    const existing = await this.repo.findChecklistItemById(id);
    if (!existing) throw new Error('Checklist item not found');
    await this.repo.updateChecklistItem(id, data);
    const item = await this.repo.findChecklistItemById(id);
    if (!item) throw new Error('Checklist item not found');
    return item;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private resolveResult(item: ChecklistItemResponse, affected: number): CheckResultValue {
    if (affected === 0) return 'PASS';
    if (item.ruleCode && ADVISORY_RULES.has(item.ruleCode)) return 'WARNING';
    return item.severity === 'CRITICAL' || item.severity === 'HIGH' ? 'FAIL' : 'WARNING';
  }

  private buildDetail(
    item: ChecklistItemResponse,
    result: CheckResultValue,
    affected: number,
    sample: RuleSample[],
    notes: string[],
  ): string {
    const head = affected === 0
      ? `No records failed "${item.title}".`
      : `${affected} record${affected === 1 ? '' : 's'} failed "${item.title}"`
        + `${result === 'WARNING' ? ' (reported as a warning)' : ''}.${describeSample(sample)}`;
    return [head, ...notes].join(' ').trim();
  }

  private gradeMappingNote(): string {
    const pairs = Object.entries(GRADE_SKILL_MAP).map(([grade, skill]) => `${grade} to ${skill}`).join(', ');
    return `Skill level mapped from the piece-rate quality grade as ${pairs}; any other grade is treated as `
      + `${DEFAULT_SKILL_LEVEL}, the lowest floor, so an unmapped grade cannot produce a false finding.`;
  }

  private scoreFrom(results: CheckResultResponse[]): ComplianceScore {
    const scored = results.filter((r) => r.result === 'PASS' || r.result === 'FAIL' || r.result === 'WARNING');
    const breakdown: ComplianceScoreBreakdown[] = scored.map((r) => {
      const weight = SEVERITY_WEIGHT[r.severity] ?? 1;
      const creditEarned = r.result === 'PASS' ? weight : r.result === 'WARNING' ? weight / 2 : 0;
      return {
        code: r.code,
        title: r.title,
        category: r.category,
        severity: r.severity,
        ruleCode: r.ruleCode,
        result: r.result,
        affectedCount: r.affectedCount,
        weight,
        creditEarned,
      };
    });

    const available = breakdown.reduce((sum, b) => sum + b.weight, 0);
    const earned = breakdown.reduce((sum, b) => sum + b.creditEarned, 0);
    const score = available > 0 ? Math.round((earned / available) * 1000) / 10 : 0;
    const grade: ComplianceScore['grade'] = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';

    return {
      score,
      grade,
      passed: scored.filter((r) => r.result === 'PASS').length,
      failed: scored.filter((r) => r.result === 'FAIL').length,
      warnings: scored.filter((r) => r.result === 'WARNING').length,
      evaluated: scored.length,
      breakdown,
      weighting: {
        weights: SEVERITY_WEIGHT,
        explanation: WEIGHTING_EXPLANATION,
        gradeBands: GRADE_BANDS,
      },
    };
  }

  private normaliseFy(financialYear: string): string {
    const fy = String(financialYear ?? '').trim();
    if (!/^\d{4}-\d{4}$/.test(fy)) throw new Error("Financial year must look like '2026-2027'");
    return fy;
  }
}
