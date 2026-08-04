import { BaseRepository } from './BaseRepository';
import {
  ComplianceAuditInput,
  EmployeeStatutory,
  LwfStateRuleRow,
  MinimumWageRuleRow,
  PfClaim,
  PtStateRuleRow,
  PtStateSlabRow,
  StatutoryConfigRow,
  StatutoryNominee,
  StatutoryRegistration,
} from '../types/compliance';
import { toDateString } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface StatutoryConfigInput {
  scheme?: string;
  legalEntity?: string | null;
  country?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  employeeRatePct?: number;
  employerRatePct?: number;
  wageCeiling?: number | null;
  diversionRatePct?: number | null;
  diversionCeiling?: number | null;
  adminChargePct?: number | null;
  minAdminCharge?: number | null;
  gratuityDaysPerYear?: number | null;
  gratuityDenominator?: number | null;
  gratuityMinYears?: number | null;
  gratuityMaxAmount?: number | null;
  filingDueDay?: number | null;
  isActive?: boolean;
  notes?: string | null;
}

export interface PtRuleInput {
  stateCode?: string;
  stateName?: string;
  country?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  frequency?: string;
  genderApplicability?: string;
  annualCap?: number | null;
  filingDueDay?: number | null;
  isActive?: boolean;
  notes?: string | null;
}

export interface PtSlabInput {
  fromAmount: number;
  toAmount?: number | null;
  taxAmount: number;
  specialMonth?: number | null;
  specialMonthAmount?: number | null;
  slabOrder?: number;
}

export interface LwfRuleInput {
  stateCode?: string;
  stateName?: string;
  country?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  frequency?: string;
  employeeContribution?: number;
  employerContribution?: number;
  wageCeiling?: number | null;
  deductionMonths?: string | null;
  filingDueDay?: number | null;
  isActive?: boolean;
  notes?: string | null;
}

export interface MinimumWageInput {
  stateCode?: string;
  stateName?: string;
  skillLevel?: string;
  industry?: string | null;
  monthlyMinimum?: number;
  dailyMinimum?: number | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  isActive?: boolean;
}

export interface RegistrationInput {
  regType?: string;
  registrationNo?: string;
  legalEntity?: string | null;
  company?: string | null;
  branch?: string | null;
  country?: string;
  stateCode?: string | null;
  authorityName?: string | null;
  registeredOn?: string | null;
  validUntil?: string | null;
  portalUsername?: string | null;
  contactPerson?: string | null;
  contactPhone?: string | null;
  isActive?: boolean;
  notes?: string | null;
}

export interface EmployeeStatutoryInput {
  uan?: string | null;
  pfMemberId?: string | null;
  pfJoinedOn?: string | null;
  pfExitOn?: string | null;
  pfStatus?: string;
  vpfPercent?: number;
  vpfAmount?: number | null;
  epsApplicable?: boolean;
  esiIpNumber?: string | null;
  esiJoinedOn?: string | null;
  esiExitOn?: string | null;
  esiStatus?: string;
  esiDispensary?: string | null;
  pan?: string | null;
  panStatus?: string;
  panVerifiedOn?: string | null;
  ptStateCode?: string | null;
  lwfStateCode?: string | null;
  gratuityEligible?: boolean;
}

export interface NomineeInput {
  scheme?: string;
  nomineeName?: string;
  relation?: string;
  dob?: string | null;
  sharePct?: number;
  address?: string | null;
  isMinor?: boolean;
  guardianName?: string | null;
  documentId?: number | null;
}

export interface PfClaimInput {
  employeeId?: number;
  claimType?: string;
  claimNo?: string | null;
  formType?: string | null;
  amount?: number | null;
  previousUan?: string | null;
  previousMemberId?: string | null;
  previousEmployer?: string | null;
  reason?: string | null;
  status?: string;
  submittedOn?: string | null;
  settledOn?: string | null;
  documentId?: number | null;
  remarks?: string | null;
}

/** Columns each partial update is allowed to write, mapped to their DB names. */
const CONFIG_COLUMNS: Record<keyof StatutoryConfigInput, string> = {
  scheme: 'scheme',
  legalEntity: 'legal_entity',
  country: 'country',
  effectiveFrom: 'effective_from',
  effectiveTo: 'effective_to',
  employeeRatePct: 'employee_rate_pct',
  employerRatePct: 'employer_rate_pct',
  wageCeiling: 'wage_ceiling',
  diversionRatePct: 'diversion_rate_pct',
  diversionCeiling: 'diversion_ceiling',
  adminChargePct: 'admin_charge_pct',
  minAdminCharge: 'min_admin_charge',
  gratuityDaysPerYear: 'gratuity_days_per_year',
  gratuityDenominator: 'gratuity_denominator',
  gratuityMinYears: 'gratuity_min_years',
  gratuityMaxAmount: 'gratuity_max_amount',
  filingDueDay: 'filing_due_day',
  isActive: 'is_active',
  notes: 'notes',
};

const PT_RULE_COLUMNS: Record<keyof PtRuleInput, string> = {
  stateCode: 'state_code',
  stateName: 'state_name',
  country: 'country',
  effectiveFrom: 'effective_from',
  effectiveTo: 'effective_to',
  frequency: 'frequency',
  genderApplicability: 'gender_applicability',
  annualCap: 'annual_cap',
  filingDueDay: 'filing_due_day',
  isActive: 'is_active',
  notes: 'notes',
};

const LWF_RULE_COLUMNS: Record<keyof LwfRuleInput, string> = {
  stateCode: 'state_code',
  stateName: 'state_name',
  country: 'country',
  effectiveFrom: 'effective_from',
  effectiveTo: 'effective_to',
  frequency: 'frequency',
  employeeContribution: 'employee_contribution',
  employerContribution: 'employer_contribution',
  wageCeiling: 'wage_ceiling',
  deductionMonths: 'deduction_months',
  filingDueDay: 'filing_due_day',
  isActive: 'is_active',
  notes: 'notes',
};

const MIN_WAGE_COLUMNS: Record<keyof MinimumWageInput, string> = {
  stateCode: 'state_code',
  stateName: 'state_name',
  skillLevel: 'skill_level',
  industry: 'industry',
  monthlyMinimum: 'monthly_minimum',
  dailyMinimum: 'daily_minimum',
  effectiveFrom: 'effective_from',
  effectiveTo: 'effective_to',
  isActive: 'is_active',
};

const REGISTRATION_COLUMNS: Record<keyof RegistrationInput, string> = {
  regType: 'reg_type',
  registrationNo: 'registration_no',
  legalEntity: 'legal_entity',
  company: 'company',
  branch: 'branch',
  country: 'country',
  stateCode: 'state_code',
  authorityName: 'authority_name',
  registeredOn: 'registered_on',
  validUntil: 'valid_until',
  portalUsername: 'portal_username',
  contactPerson: 'contact_person',
  contactPhone: 'contact_phone',
  isActive: 'is_active',
  notes: 'notes',
};

const PF_CLAIM_COLUMNS: Record<keyof PfClaimInput, string> = {
  employeeId: 'employee_id',
  claimType: 'claim_type',
  claimNo: 'claim_no',
  formType: 'form_type',
  amount: 'amount',
  previousUan: 'previous_uan',
  previousMemberId: 'previous_member_id',
  previousEmployer: 'previous_employer',
  reason: 'reason',
  status: 'status',
  submittedOn: 'submitted_on',
  settledOn: 'settled_on',
  documentId: 'document_id',
  remarks: 'remarks',
};

/** Coarse device/browser tags for the audit trail, from the user agent string. */
function describeUserAgent(ua: string | null | undefined): { device: string | null; browser: string | null } {
  if (!ua) return { device: null, browser: null };
  const s = String(ua);
  const device = /Mobile|Android|iPhone|iPad/i.test(s) ? 'Mobile' : 'Desktop';
  let browser: string | null = null;
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/Chrome\//i.test(s)) browser = 'Chrome';
  else if (/Safari\//i.test(s)) browser = 'Safari';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/curl\//i.test(s)) browser = 'curl';
  return { device, browser: browser ? browser.slice(0, 120) : null };
}

function stringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return s.slice(0, 500);
}

/**
 * Statutory master data: scheme configuration, state rules, establishment
 * registrations, per-employee enrolment, nominations and PF claims.
 *
 * Raw SQL with `?` placeholders throughout; every table that carries
 * `deleted_at` is filtered on it. Rate and slab rows are returned in the shape
 * `utils/statutoryRules.ts` expects, so a caller can load once and compute for
 * ten thousand employees without touching the database again.
 */
export class StatutoryRepository extends BaseRepository {
  /** Public escape hatch so services can wrap multi-table writes in one txn. */
  async withTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  // =========================================================================
  // Scheme configuration
  // =========================================================================

  async findConfigs(scheme?: string, conn?: any): Promise<StatutoryConfigRow[]> {
    let sql = 'SELECT * FROM statutory_config WHERE deleted_at IS NULL';
    const params: any[] = [];
    if (scheme) {
      sql += ' AND scheme = ?';
      params.push(scheme);
    }
    sql += ' ORDER BY scheme ASC, effective_from DESC';
    const rows = conn ? ((await conn.query(sql, params))[0] as any[]) : await this.query<any[]>(sql, params);
    return rows.map((r) => this.toConfigRow(r));
  }

  async findConfigById(id: number): Promise<StatutoryConfigRow | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM statutory_config WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toConfigRow(rows[0]) : null;
  }

  async createConfig(data: StatutoryConfigInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO statutory_config
        (scheme, legal_entity, country, effective_from, effective_to, employee_rate_pct, employer_rate_pct,
         wage_ceiling, diversion_rate_pct, diversion_ceiling, admin_charge_pct, min_admin_charge,
         gratuity_days_per_year, gratuity_denominator, gratuity_min_years, gratuity_max_amount,
         filing_due_day, is_active, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.scheme,
        data.legalEntity ?? null,
        data.country ?? 'IN',
        data.effectiveFrom,
        data.effectiveTo ?? null,
        data.employeeRatePct ?? 0,
        data.employerRatePct ?? 0,
        data.wageCeiling ?? null,
        data.diversionRatePct ?? null,
        data.diversionCeiling ?? null,
        data.adminChargePct ?? null,
        data.minAdminCharge ?? null,
        data.gratuityDaysPerYear ?? null,
        data.gratuityDenominator ?? null,
        data.gratuityMinYears ?? null,
        data.gratuityMaxAmount ?? null,
        data.filingDueDay ?? null,
        data.isActive === undefined ? true : data.isActive,
        data.notes ?? null,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateConfig(id: number, data: StatutoryConfigInput): Promise<void> {
    await this.partialUpdate('statutory_config', CONFIG_COLUMNS, id, data);
  }

  // =========================================================================
  // Professional tax
  // =========================================================================

  async findPtRules(stateCode?: string): Promise<PtStateRuleRow[]> {
    let sql = 'SELECT * FROM pt_state_rules WHERE deleted_at IS NULL';
    const params: any[] = [];
    if (stateCode) {
      sql += ' AND state_code = ?';
      params.push(stateCode);
    }
    sql += ' ORDER BY state_code ASC, effective_from DESC';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toPtRuleRow(r));
  }

  async findPtRuleById(id: number): Promise<PtStateRuleRow | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM pt_state_rules WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toPtRuleRow(rows[0]) : null;
  }

  async createPtRule(data: PtRuleInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO pt_state_rules
        (state_code, state_name, country, effective_from, effective_to, frequency,
         gender_applicability, annual_cap, filing_due_day, is_active, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.stateCode,
        data.stateName,
        data.country ?? 'IN',
        data.effectiveFrom,
        data.effectiveTo ?? null,
        data.frequency ?? 'MONTHLY',
        data.genderApplicability ?? 'ALL',
        data.annualCap ?? null,
        data.filingDueDay ?? null,
        data.isActive === undefined ? true : data.isActive,
        data.notes ?? null,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updatePtRule(id: number, data: PtRuleInput): Promise<void> {
    await this.partialUpdate('pt_state_rules', PT_RULE_COLUMNS, id, data);
  }

  /** Every slab in the system, or only those of one rule. */
  async findPtSlabs(ruleId?: number): Promise<PtStateSlabRow[]> {
    let sql = 'SELECT * FROM pt_state_slabs';
    const params: any[] = [];
    if (ruleId) {
      sql += ' WHERE rule_id = ?';
      params.push(ruleId);
    }
    sql += ' ORDER BY rule_id ASC, slab_order ASC, from_amount ASC';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      rule_id: Number(r.rule_id),
      from_amount: num(r.from_amount),
      to_amount: r.to_amount === null ? null : num(r.to_amount),
      tax_amount: num(r.tax_amount),
      special_month: r.special_month === null ? null : Number(r.special_month),
      special_month_amount: r.special_month_amount === null ? null : num(r.special_month_amount),
      slab_order: Number(r.slab_order),
    }));
  }

  /**
   * Replace a rule's slab table wholesale.
   *
   * A partial slab edit can leave a gap that silently taxes an employee at zero,
   * so the whole ladder is swapped inside one transaction or not at all.
   */
  async replacePtSlabs(ruleId: number, slabs: PtSlabInput[]): Promise<void> {
    await this.transaction(async (conn) => {
      await conn.query('DELETE FROM pt_state_slabs WHERE rule_id = ?', [ruleId]);
      let order = 1;
      for (const slab of slabs) {
        await conn.query(
          `INSERT INTO pt_state_slabs
            (rule_id, from_amount, to_amount, tax_amount, special_month, special_month_amount, slab_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            ruleId,
            slab.fromAmount ?? 0,
            slab.toAmount ?? null,
            slab.taxAmount ?? 0,
            slab.specialMonth ?? null,
            slab.specialMonthAmount ?? null,
            slab.slabOrder ?? order,
          ],
        );
        order += 1;
      }
    });
  }

  // =========================================================================
  // Labour welfare fund
  // =========================================================================

  async findLwfRules(stateCode?: string): Promise<LwfStateRuleRow[]> {
    let sql = 'SELECT * FROM lwf_state_rules WHERE deleted_at IS NULL';
    const params: any[] = [];
    if (stateCode) {
      sql += ' AND state_code = ?';
      params.push(stateCode);
    }
    sql += ' ORDER BY state_code ASC, effective_from DESC';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      state_code: String(r.state_code),
      state_name: String(r.state_name),
      country: String(r.country ?? 'IN'),
      effective_from: toDateString(r.effective_from),
      effective_to: r.effective_to ? toDateString(r.effective_to) : null,
      frequency: r.frequency,
      employee_contribution: num(r.employee_contribution),
      employer_contribution: num(r.employer_contribution),
      wage_ceiling: r.wage_ceiling === null ? null : num(r.wage_ceiling),
      deduction_months: r.deduction_months ?? null,
      filing_due_day: r.filing_due_day === null ? null : Number(r.filing_due_day),
      is_active: r.is_active,
      notes: r.notes ?? null,
    }));
  }

  async createLwfRule(data: LwfRuleInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO lwf_state_rules
        (state_code, state_name, country, effective_from, effective_to, frequency,
         employee_contribution, employer_contribution, wage_ceiling, deduction_months,
         filing_due_day, is_active, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.stateCode,
        data.stateName,
        data.country ?? 'IN',
        data.effectiveFrom,
        data.effectiveTo ?? null,
        data.frequency ?? 'HALF_YEARLY',
        data.employeeContribution ?? 0,
        data.employerContribution ?? 0,
        data.wageCeiling ?? null,
        data.deductionMonths ?? null,
        data.filingDueDay ?? null,
        data.isActive === undefined ? true : data.isActive,
        data.notes ?? null,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateLwfRule(id: number, data: LwfRuleInput): Promise<void> {
    await this.partialUpdate('lwf_state_rules', LWF_RULE_COLUMNS, id, data);
  }

  // =========================================================================
  // Minimum wage
  // =========================================================================

  async findMinimumWageRules(stateCode?: string): Promise<MinimumWageRuleRow[]> {
    let sql = 'SELECT * FROM minimum_wage_rules WHERE deleted_at IS NULL';
    const params: any[] = [];
    if (stateCode) {
      sql += ' AND state_code = ?';
      params.push(stateCode);
    }
    sql += ' ORDER BY state_code ASC, skill_level ASC, effective_from DESC';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      state_code: String(r.state_code),
      state_name: String(r.state_name),
      skill_level: r.skill_level,
      industry: r.industry ?? null,
      monthly_minimum: num(r.monthly_minimum),
      daily_minimum: r.daily_minimum === null ? null : num(r.daily_minimum),
      effective_from: toDateString(r.effective_from),
      effective_to: r.effective_to ? toDateString(r.effective_to) : null,
      is_active: r.is_active,
    }));
  }

  async createMinimumWageRule(data: MinimumWageInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO minimum_wage_rules
        (state_code, state_name, skill_level, industry, monthly_minimum, daily_minimum,
         effective_from, effective_to, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.stateCode,
        data.stateName,
        data.skillLevel ?? 'SKILLED',
        data.industry ?? null,
        data.monthlyMinimum ?? 0,
        data.dailyMinimum ?? null,
        data.effectiveFrom,
        data.effectiveTo ?? null,
        data.isActive === undefined ? true : data.isActive,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateMinimumWageRule(id: number, data: MinimumWageInput): Promise<void> {
    await this.partialUpdate('minimum_wage_rules', MIN_WAGE_COLUMNS, id, data);
  }

  // =========================================================================
  // Establishment registrations
  // =========================================================================

  async findRegistrations(regType?: string): Promise<StatutoryRegistration[]> {
    let sql = 'SELECT * FROM statutory_registrations WHERE deleted_at IS NULL';
    const params: any[] = [];
    if (regType) {
      sql += ' AND reg_type = ?';
      params.push(regType);
    }
    sql += ' ORDER BY reg_type ASC, id ASC';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toRegistration(r));
  }

  async findRegistrationById(id: number): Promise<StatutoryRegistration | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM statutory_registrations WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toRegistration(rows[0]) : null;
  }

  /** First active registration of a type, used to stamp challans and filings. */
  async findActiveRegistration(regType: string, stateCode?: string | null): Promise<StatutoryRegistration | null> {
    let sql = 'SELECT * FROM statutory_registrations WHERE deleted_at IS NULL AND is_active = true AND reg_type = ?';
    const params: any[] = [regType];
    if (stateCode) {
      sql += ' AND (state_code = ? OR state_code IS NULL)';
      params.push(stateCode);
    }
    sql += ' ORDER BY (state_code IS NULL) ASC, id ASC LIMIT 1';
    const rows = await this.query<any[]>(sql, params);
    return rows[0] ? this.toRegistration(rows[0]) : null;
  }

  async createRegistration(data: RegistrationInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO statutory_registrations
        (reg_type, registration_no, legal_entity, company, branch, country, state_code,
         authority_name, registered_on, valid_until, portal_username, contact_person,
         contact_phone, is_active, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.regType,
        data.registrationNo,
        data.legalEntity ?? null,
        data.company ?? null,
        data.branch ?? null,
        data.country ?? 'IN',
        data.stateCode ?? null,
        data.authorityName ?? null,
        data.registeredOn ?? null,
        data.validUntil ?? null,
        data.portalUsername ?? null,
        data.contactPerson ?? null,
        data.contactPhone ?? null,
        data.isActive === undefined ? true : data.isActive,
        data.notes ?? null,
        userId,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateRegistration(id: number, data: RegistrationInput, userId: number): Promise<void> {
    await this.partialUpdate('statutory_registrations', REGISTRATION_COLUMNS, id, data, 'updated_by', userId);
  }

  async softDeleteRegistration(id: number, userId: number): Promise<void> {
    await this.query(
      'UPDATE statutory_registrations SET deleted_at = NOW(), updated_by = ? WHERE id = ? AND deleted_at IS NULL',
      [userId, id],
    );
  }

  // =========================================================================
  // Per-employee enrolment
  // =========================================================================

  async findEmployeeStatutory(employeeId: number): Promise<EmployeeStatutory | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM employee_statutory WHERE employee_id = ?',
      [employeeId],
    );
    return rows[0] ? this.toEmployeeStatutory(rows[0]) : null;
  }

  /**
   * Insert-or-update the enrolment row. A `NULL` employee_statutory row is not
   * the same as an absent one, so upsert rather than requiring a create call.
   */
  async upsertEmployeeStatutory(employeeId: number, data: EmployeeStatutoryInput, userId: number): Promise<void> {
    const existing = await this.query<any[]>(
      'SELECT id FROM employee_statutory WHERE employee_id = ?',
      [employeeId],
    );
    if (existing.length === 0) {
      await this.query(
        `INSERT INTO employee_statutory
          (employee_id, uan, pf_member_id, pf_joined_on, pf_exit_on, pf_status, vpf_percent, vpf_amount,
           eps_applicable, esi_ip_number, esi_joined_on, esi_exit_on, esi_status, esi_dispensary,
           pan, pan_status, pan_verified_on, pt_state_code, lwf_state_code, gratuity_eligible,
           created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          employeeId,
          data.uan ?? null,
          data.pfMemberId ?? null,
          data.pfJoinedOn ?? null,
          data.pfExitOn ?? null,
          data.pfStatus ?? 'NOT_ENROLLED',
          data.vpfPercent ?? 0,
          data.vpfAmount ?? null,
          data.epsApplicable === undefined ? true : data.epsApplicable,
          data.esiIpNumber ?? null,
          data.esiJoinedOn ?? null,
          data.esiExitOn ?? null,
          data.esiStatus ?? 'NOT_ENROLLED',
          data.esiDispensary ?? null,
          data.pan ?? null,
          data.panStatus ?? 'NOT_PROVIDED',
          data.panVerifiedOn ?? null,
          data.ptStateCode ?? null,
          data.lwfStateCode ?? null,
          data.gratuityEligible === undefined ? true : data.gratuityEligible,
          userId,
          userId,
        ],
      );
      return;
    }

    const columns: Record<string, string> = {
      uan: 'uan',
      pfMemberId: 'pf_member_id',
      pfJoinedOn: 'pf_joined_on',
      pfExitOn: 'pf_exit_on',
      pfStatus: 'pf_status',
      vpfPercent: 'vpf_percent',
      vpfAmount: 'vpf_amount',
      epsApplicable: 'eps_applicable',
      esiIpNumber: 'esi_ip_number',
      esiJoinedOn: 'esi_joined_on',
      esiExitOn: 'esi_exit_on',
      esiStatus: 'esi_status',
      esiDispensary: 'esi_dispensary',
      pan: 'pan',
      panStatus: 'pan_status',
      panVerifiedOn: 'pan_verified_on',
      ptStateCode: 'pt_state_code',
      lwfStateCode: 'lwf_state_code',
      gratuityEligible: 'gratuity_eligible',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    sets.push('updated_by = ?');
    params.push(userId, employeeId);
    await this.query(`UPDATE employee_statutory SET ${sets.join(', ')} WHERE employee_id = ?`, params);
  }

  // =========================================================================
  // Nominees
  // =========================================================================

  async findNominees(employeeId: number): Promise<StatutoryNominee[]> {
    const rows = await this.query<any[]>(
      'SELECT * FROM statutory_nominees WHERE employee_id = ? AND deleted_at IS NULL ORDER BY scheme ASC, id ASC',
      [employeeId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      scheme: r.scheme,
      nomineeName: String(r.nominee_name),
      relation: String(r.relation),
      dob: r.dob ? toDateString(r.dob) : null,
      sharePct: num(r.share_pct),
      address: r.address ?? null,
      isMinor: !!r.is_minor,
      guardianName: r.guardian_name ?? null,
      documentId: r.document_id === null ? null : Number(r.document_id),
    }));
  }

  async createNominee(employeeId: number, data: NomineeInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO statutory_nominees
        (employee_id, scheme, nominee_name, relation, dob, share_pct, address, is_minor,
         guardian_name, document_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employeeId,
        data.scheme ?? 'PF',
        data.nomineeName,
        data.relation,
        data.dob ?? null,
        data.sharePct ?? 100,
        data.address ?? null,
        data.isMinor ?? false,
        data.guardianName ?? null,
        data.documentId ?? null,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateNominee(id: number, data: NomineeInput): Promise<void> {
    const columns: Record<string, string> = {
      scheme: 'scheme',
      nomineeName: 'nominee_name',
      relation: 'relation',
      dob: 'dob',
      sharePct: 'share_pct',
      address: 'address',
      isMinor: 'is_minor',
      guardianName: 'guardian_name',
      documentId: 'document_id',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    params.push(id);
    await this.query(`UPDATE statutory_nominees SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
  }

  async softDeleteNominee(id: number): Promise<void> {
    await this.query('UPDATE statutory_nominees SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  async findNomineeById(id: number): Promise<{ id: number; employeeId: number } | null> {
    const rows = await this.query<any[]>(
      'SELECT id, employee_id FROM statutory_nominees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? { id: Number(rows[0].id), employeeId: Number(rows[0].employee_id) } : null;
  }

  // =========================================================================
  // PF claims
  // =========================================================================

  async findPfClaims(filters: { employeeId?: number; status?: string; limit?: number } = {}): Promise<PfClaim[]> {
    let sql = `SELECT c.*, e.full_name AS employee_name
               FROM pf_claims c
               JOIN employees e ON e.id = c.employee_id
               WHERE c.deleted_at IS NULL`;
    const params: any[] = [];
    if (filters.employeeId) {
      sql += ' AND c.employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.status) {
      sql += ' AND c.status = ?';
      params.push(filters.status);
    }
    const limit = Math.min(1000, Math.max(1, Math.floor(Number(filters.limit) || 200)));
    sql += ` ORDER BY c.created_at DESC, c.id DESC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      claimType: r.claim_type,
      claimNo: r.claim_no ?? null,
      formType: r.form_type ?? null,
      amount: r.amount === null ? null : num(r.amount),
      previousUan: r.previous_uan ?? null,
      previousMemberId: r.previous_member_id ?? null,
      previousEmployer: r.previous_employer ?? null,
      reason: r.reason ?? null,
      status: r.status,
      submittedOn: r.submitted_on ? toDateString(r.submitted_on) : null,
      settledOn: r.settled_on ? toDateString(r.settled_on) : null,
      documentId: r.document_id === null ? null : Number(r.document_id),
      remarks: r.remarks ?? null,
    }));
  }

  async createPfClaim(data: PfClaimInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO pf_claims
        (employee_id, claim_type, claim_no, form_type, amount, previous_uan, previous_member_id,
         previous_employer, reason, status, submitted_on, settled_on, document_id, remarks,
         created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employeeId,
        data.claimType,
        data.claimNo ?? null,
        data.formType ?? null,
        data.amount ?? null,
        data.previousUan ?? null,
        data.previousMemberId ?? null,
        data.previousEmployer ?? null,
        data.reason ?? null,
        data.status ?? 'DRAFT',
        data.submittedOn ?? null,
        data.settledOn ?? null,
        data.documentId ?? null,
        data.remarks ?? null,
        userId,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updatePfClaim(id: number, data: PfClaimInput, userId: number): Promise<void> {
    await this.partialUpdate('pf_claims', PF_CLAIM_COLUMNS, id, data, 'updated_by', userId);
  }

  // =========================================================================
  // Audit
  // =========================================================================

  /**
   * Append-only compliance audit row.
   *
   * Never throws: losing an audit row must not roll back the statutory action
   * that produced it, but the gap is written to the console so it is visible.
   */
  async logAudit(entry: ComplianceAuditInput): Promise<void> {
    const { device, browser } = describeUserAgent(entry.userAgent);
    try {
      await this.query(
        `INSERT INTO payroll_audit_logs
           (entity_type, entity_id, employee_id, period_id, run_id, action, summary,
            field_name, previous_value, new_value, actor_user_id, actor_name, actor_role,
            ip_address, user_agent, device, browser)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.entityType,
          entry.entityId ?? null,
          entry.employeeId ?? null,
          entry.periodId ?? null,
          entry.action,
          String(entry.summary).slice(0, 500),
          entry.fieldName ?? null,
          stringify(entry.previousValue),
          stringify(entry.newValue),
          entry.actorUserId ?? null,
          entry.actorName ?? null,
          entry.actorRole ?? null,
          entry.ipAddress ?? null,
          entry.userAgent ? String(entry.userAgent).slice(0, 400) : null,
          device,
          browser,
        ],
      );
    } catch (err: any) {
      console.error('[statutory-audit] failed to write audit row:', err?.message ?? err);
    }
  }

  // =========================================================================
  // Internals
  // =========================================================================

  /** Shared partial-update helper: only supplied keys are written. */
  private async partialUpdate(
    table: string,
    columns: Record<string, string>,
    id: number,
    data: Record<string, any>,
    actorColumn?: string,
    actorValue?: number,
  ): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      const value = data[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    if (actorColumn) {
      sets.push(`${actorColumn} = ?`);
      params.push(actorValue ?? null);
    }
    params.push(id);
    await this.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
  }

  private toConfigRow(r: any): StatutoryConfigRow {
    return {
      id: Number(r.id),
      scheme: r.scheme,
      legal_entity: r.legal_entity ?? null,
      country: String(r.country ?? 'IN'),
      effective_from: toDateString(r.effective_from),
      effective_to: r.effective_to ? toDateString(r.effective_to) : null,
      employee_rate_pct: num(r.employee_rate_pct),
      employer_rate_pct: num(r.employer_rate_pct),
      wage_ceiling: r.wage_ceiling === null ? null : num(r.wage_ceiling),
      diversion_rate_pct: r.diversion_rate_pct === null ? null : num(r.diversion_rate_pct),
      diversion_ceiling: r.diversion_ceiling === null ? null : num(r.diversion_ceiling),
      admin_charge_pct: r.admin_charge_pct === null ? null : num(r.admin_charge_pct),
      min_admin_charge: r.min_admin_charge === null ? null : num(r.min_admin_charge),
      gratuity_days_per_year: r.gratuity_days_per_year === null ? null : num(r.gratuity_days_per_year),
      gratuity_denominator: r.gratuity_denominator === null ? null : num(r.gratuity_denominator),
      gratuity_min_years: r.gratuity_min_years === null ? null : num(r.gratuity_min_years),
      gratuity_max_amount: r.gratuity_max_amount === null ? null : num(r.gratuity_max_amount),
      filing_due_day: r.filing_due_day === null ? null : Number(r.filing_due_day),
      is_active: r.is_active,
      notes: r.notes ?? null,
    };
  }

  private toPtRuleRow(r: any): PtStateRuleRow {
    return {
      id: Number(r.id),
      state_code: String(r.state_code),
      state_name: String(r.state_name),
      country: String(r.country ?? 'IN'),
      effective_from: toDateString(r.effective_from),
      effective_to: r.effective_to ? toDateString(r.effective_to) : null,
      frequency: r.frequency,
      gender_applicability: r.gender_applicability,
      annual_cap: r.annual_cap === null ? null : num(r.annual_cap),
      filing_due_day: r.filing_due_day === null ? null : Number(r.filing_due_day),
      is_active: r.is_active,
      notes: r.notes ?? null,
    };
  }

  private toRegistration(r: any): StatutoryRegistration {
    return {
      id: Number(r.id),
      regType: r.reg_type,
      registrationNo: String(r.registration_no),
      legalEntity: r.legal_entity ?? null,
      company: r.company ?? null,
      branch: r.branch ?? null,
      country: String(r.country ?? 'IN'),
      stateCode: r.state_code ?? null,
      authorityName: r.authority_name ?? null,
      registeredOn: r.registered_on ? toDateString(r.registered_on) : null,
      validUntil: r.valid_until ? toDateString(r.valid_until) : null,
      portalUsername: r.portal_username ?? null,
      contactPerson: r.contact_person ?? null,
      contactPhone: r.contact_phone ?? null,
      isActive: !!r.is_active,
      notes: r.notes ?? null,
    };
  }

  private toEmployeeStatutory(r: any): EmployeeStatutory {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      uan: r.uan ?? null,
      pfMemberId: r.pf_member_id ?? null,
      pfJoinedOn: r.pf_joined_on ? toDateString(r.pf_joined_on) : null,
      pfExitOn: r.pf_exit_on ? toDateString(r.pf_exit_on) : null,
      pfStatus: r.pf_status,
      vpfPercent: num(r.vpf_percent),
      vpfAmount: r.vpf_amount === null ? null : num(r.vpf_amount),
      epsApplicable: !!r.eps_applicable,
      esiIpNumber: r.esi_ip_number ?? null,
      esiJoinedOn: r.esi_joined_on ? toDateString(r.esi_joined_on) : null,
      esiExitOn: r.esi_exit_on ? toDateString(r.esi_exit_on) : null,
      esiStatus: r.esi_status,
      esiDispensary: r.esi_dispensary ?? null,
      pan: r.pan ?? null,
      panStatus: r.pan_status,
      panVerifiedOn: r.pan_verified_on ? toDateString(r.pan_verified_on) : null,
      ptStateCode: r.pt_state_code ?? null,
      lwfStateCode: r.lwf_state_code ?? null,
      gratuityEligible: !!r.gratuity_eligible,
    };
  }
}
