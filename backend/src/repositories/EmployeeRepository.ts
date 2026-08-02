import { BaseRepository } from './BaseRepository';
import { EmployeeRow, EmployeeSpecialistRow, EmployeeResponse } from '../types';
import { EmployeeProfileResponse } from '../types/hrms';
import {
  EmploymentDetailsResponse,
  OrganizationDetailsResponse,
  EmploymentType,
  MaritalStatus,
} from '../types/profile';
import { toDateString, todayString } from '../utils/dateUtils';

export interface CreateEmployeeInput {
  empCode: string;
  fullName: string;
  shortName: string;
  grade: string;
  workerType: string;
  joinedAt: string;
  whatsapp?: string | null;
  department?: string | null;
  designation?: string | null;
  monthlySalary?: number | null;
  shiftId?: number | null;
}

export interface UpdateProfileInput {
  fullName?: string;
  shortName?: string;
  grade?: string;
  whatsapp?: string | null;
  address?: string | null;
  city?: string | null;
  dob?: string | null;
  gender?: string | null;
  bloodGroup?: string | null;
  aadhaarNumber?: string | null;
  pan?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  bankIfsc?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  department?: string | null;
  designation?: string | null;
  reportingManagerId?: number | null;
  monthlySalary?: number | null;
  pfApplicable?: boolean;
  esiApplicable?: boolean;
  shiftId?: number | null;
  photoUrl?: string | null;

  // --- Personal -------------------------------------------------------------
  preferredName?: string | null;
  maritalStatus?: MaritalStatus | null;
  nationality?: string | null;
  religion?: string | null;
  hasDisability?: boolean;
  disabilityDetails?: string | null;
  biography?: string | null;

  // --- Identity documents ---------------------------------------------------
  passportNumber?: string | null;
  passportExpiry?: string | null;
  visaNumber?: string | null;
  visaExpiry?: string | null;
  drivingLicense?: string | null;
  voterId?: string | null;
  taxId?: string | null;

  // --- Contact --------------------------------------------------------------
  mobile?: string | null;
  alternateMobile?: string | null;
  personalEmail?: string | null;
  officialEmail?: string | null;
  permanentAddress?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  contactPrefEmail?: boolean;
  contactPrefSms?: boolean;
  contactPrefWhatsapp?: boolean;

  // --- Emergency ------------------------------------------------------------
  emergencyContactRelation?: string | null;
  emergencyContactAddress?: string | null;
  emergencyAltName?: string | null;
  emergencyAltPhone?: string | null;
  emergencyAltRelation?: string | null;
  medicalContactName?: string | null;
  medicalContactPhone?: string | null;

  // --- Employment -----------------------------------------------------------
  employmentType?: EmploymentType | null;
  confirmationDate?: string | null;
  probationMonths?: number | null;
  noticePeriodDays?: number | null;
  retirementDate?: string | null;
  workLocation?: string | null;
  officeLocation?: string | null;
  jobRole?: string | null;
  jobLevel?: string | null;
  hrPartnerId?: number | null;
  costCenter?: string | null;
  payrollGroup?: string | null;

  // --- Organization ---------------------------------------------------------
  company?: string | null;
  businessUnit?: string | null;
  division?: string | null;
  section?: string | null;
  team?: string | null;
  branch?: string | null;
  region?: string | null;
  legalEntity?: string | null;

  // --- Bank / payroll -------------------------------------------------------
  bankBranch?: string | null;
  upiId?: string | null;
  isSalaryAccount?: boolean;
  payGrade?: string | null;
  salaryStructure?: string | null;
  gratuityApplicable?: boolean;
  insurancePolicyNo?: string | null;
  uanNumber?: string | null;
  esicNumber?: string | null;
}

/**
 * Columns that updateProfile is allowed to write, mapped to their DB names.
 * `emp_code`, `work_status`, `joined_at` and `resigned_at` are deliberately
 * absent: they are lifecycle fields owned by dedicated operations.
 */
const PROFILE_COLUMNS: Record<keyof UpdateProfileInput, string> = {
  fullName: 'full_name',
  shortName: 'short_name',
  grade: 'grade',
  whatsapp: 'whatsapp',
  address: 'address',
  city: 'city',
  dob: 'dob',
  gender: 'gender',
  bloodGroup: 'blood_group',
  aadhaarNumber: 'aadhaar_number',
  pan: 'pan',
  bankName: 'bank_name',
  bankAccount: 'bank_account',
  bankIfsc: 'bank_ifsc',
  emergencyContactName: 'emergency_contact_name',
  emergencyContactPhone: 'emergency_contact_phone',
  department: 'department',
  designation: 'designation',
  reportingManagerId: 'reporting_manager_id',
  monthlySalary: 'monthly_salary',
  pfApplicable: 'pf_applicable',
  esiApplicable: 'esi_applicable',
  shiftId: 'shift_id',
  photoUrl: 'photo_url',

  preferredName: 'preferred_name',
  maritalStatus: 'marital_status',
  nationality: 'nationality',
  religion: 'religion',
  hasDisability: 'has_disability',
  disabilityDetails: 'disability_details',
  biography: 'biography',

  passportNumber: 'passport_number',
  passportExpiry: 'passport_expiry',
  visaNumber: 'visa_number',
  visaExpiry: 'visa_expiry',
  drivingLicense: 'driving_license',
  voterId: 'voter_id',
  taxId: 'tax_id',

  mobile: 'mobile',
  alternateMobile: 'alternate_mobile',
  personalEmail: 'personal_email',
  officialEmail: 'official_email',
  permanentAddress: 'permanent_address',
  state: 'state',
  country: 'country',
  postalCode: 'postal_code',
  contactPrefEmail: 'contact_pref_email',
  contactPrefSms: 'contact_pref_sms',
  contactPrefWhatsapp: 'contact_pref_whatsapp',

  emergencyContactRelation: 'emergency_contact_relation',
  emergencyContactAddress: 'emergency_contact_address',
  emergencyAltName: 'emergency_alt_name',
  emergencyAltPhone: 'emergency_alt_phone',
  emergencyAltRelation: 'emergency_alt_relation',
  medicalContactName: 'medical_contact_name',
  medicalContactPhone: 'medical_contact_phone',

  employmentType: 'employment_type',
  confirmationDate: 'confirmation_date',
  probationMonths: 'probation_months',
  noticePeriodDays: 'notice_period_days',
  retirementDate: 'retirement_date',
  workLocation: 'work_location',
  officeLocation: 'office_location',
  jobRole: 'job_role',
  jobLevel: 'job_level',
  hrPartnerId: 'hr_partner_id',
  costCenter: 'cost_center',
  payrollGroup: 'payroll_group',

  company: 'company',
  businessUnit: 'business_unit',
  division: 'division',
  section: 'section',
  team: 'team',
  branch: 'branch',
  region: 'region',
  legalEntity: 'legal_entity',

  bankBranch: 'bank_branch',
  upiId: 'upi_id',
  isSalaryAccount: 'is_salary_account',
  payGrade: 'pay_grade',
  salaryStructure: 'salary_structure',
  gratuityApplicable: 'gratuity_applicable',
  insurancePolicyNo: 'insurance_policy_no',
  uanNumber: 'uan_number',
  esicNumber: 'esic_number',
};

/**
 * NOT NULL boolean columns added by the profile migration. Blanks coming from a
 * form must land as `false`/`true`, never as NULL (which the schema rejects).
 */
const BOOLEAN_NOT_NULL_KEYS = new Set<keyof UpdateProfileInput>([
  'hasDisability',
  'contactPrefEmail',
  'contactPrefSms',
  'contactPrefWhatsapp',
  'isSalaryAccount',
  'gratuityApplicable',
]);

/** Field lists behind the profile completeness meter — explicit and stable. */
const COMPLETENESS_SECTIONS: { section: string; columns: string[] }[] = [
  {
    section: 'Personal',
    columns: [
      'full_name', 'preferred_name', 'dob', 'gender', 'marital_status',
      'blood_group', 'nationality', 'religion', 'photo_url', 'biography',
    ],
  },
  {
    section: 'Contact',
    columns: [
      'mobile', 'alternate_mobile', 'personal_email', 'official_email', 'whatsapp',
      'address', 'permanent_address', 'city', 'state', 'country', 'postal_code',
    ],
  },
  {
    section: 'Emergency',
    columns: [
      'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation',
      'emergency_contact_address', 'emergency_alt_name', 'emergency_alt_phone',
      'emergency_alt_relation', 'medical_contact_name', 'medical_contact_phone',
    ],
  },
  {
    section: 'Employment',
    columns: [
      'employment_type', 'joined_at', 'confirmation_date', 'probation_months',
      'notice_period_days', 'work_location', 'office_location', 'job_role',
      'job_level', 'designation', 'grade', 'shift_id', 'reporting_manager_id',
      'hr_partner_id',
    ],
  },
  {
    section: 'Organization',
    columns: [
      'company', 'business_unit', 'division', 'department', 'section',
      'team', 'branch', 'region', 'legal_entity',
    ],
  },
  {
    section: 'Bank',
    columns: ['bank_name', 'bank_account', 'bank_ifsc', 'bank_branch', 'upi_id'],
  },
  {
    section: 'Payroll',
    columns: [
      'monthly_salary', 'pay_grade', 'salary_structure', 'cost_center',
      'payroll_group', 'uan_number', 'esic_number', 'insurance_policy_no',
      'pan', 'aadhaar_number',
    ],
  },
];

export interface ProfileCompletenessRow {
  section: string;
  filled: number;
  total: number;
  pct: number;
}

export interface DirectoryFilters {
  search?: string;
  department?: string;
  branch?: string;
  employmentType?: string;
  workStatus?: string;
}

export interface DirectoryEntry {
  id: number;
  empCode: string;
  fullName: string;
  preferredName: string | null;
  designation: string | null;
  department: string | null;
  branch: string | null;
  photoUrl: string | null;
  officialEmail: string | null;
  mobile: string | null;
}

/**
 * The full profile payload. Extends the original `EmployeeProfileResponse` so
 * every key the frontend already reads keeps its exact meaning and position;
 * the profile columns added by migration 032 are purely additive.
 */
export interface EmployeeFullProfileResponse extends EmployeeProfileResponse {
  // Personal
  preferredName: string | null;
  maritalStatus: MaritalStatus | null;
  nationality: string | null;
  religion: string | null;
  hasDisability: boolean;
  disabilityDetails: string | null;
  biography: string | null;

  // Identity (secrets never leave the server in the clear)
  passportNumber: null;
  passportMasked: string | null;
  hasPassport: boolean;
  passportExpiry: string | null;
  visaNumber: string | null;
  visaExpiry: string | null;
  drivingLicense: string | null;
  voterId: string | null;
  taxId: string | null;

  // Contact
  mobile: string | null;
  alternateMobile: string | null;
  personalEmail: string | null;
  officialEmail: string | null;
  permanentAddress: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  contactPrefEmail: boolean;
  contactPrefSms: boolean;
  contactPrefWhatsapp: boolean;

  // Emergency
  emergencyContactRelation: string | null;
  emergencyContactAddress: string | null;
  emergencyAltName: string | null;
  emergencyAltPhone: string | null;
  emergencyAltRelation: string | null;
  medicalContactName: string | null;
  medicalContactPhone: string | null;

  // Employment
  employmentType: EmploymentType | null;
  confirmationDate: string | null;
  probationMonths: number | null;
  noticePeriodDays: number | null;
  retirementDate: string | null;
  workLocation: string | null;
  officeLocation: string | null;
  jobRole: string | null;
  jobLevel: string | null;
  hrPartnerId: number | null;
  hrPartnerName: string | null;
  costCenter: string | null;
  payrollGroup: string | null;

  // Organization
  company: string | null;
  businessUnit: string | null;
  division: string | null;
  section: string | null;
  team: string | null;
  branch: string | null;
  region: string | null;
  legalEntity: string | null;

  // Bank / payroll
  bankBranch: string | null;
  upiId: string | null;
  isSalaryAccount: boolean;
  payGrade: string | null;
  salaryStructure: string | null;
  gratuityApplicable: boolean;
  insurancePolicyNo: string | null;
  uanNumber: string | null;
  esicNumber: string | null;
}

export class EmployeeRepository extends BaseRepository {
  /**
   * Single-pass listing: aggregates come from grouped sub-selects rather than
   * per-employee round trips, so the query count stays constant as headcount grows.
   */
  async findAll(search?: string, workStatus?: string): Promise<EmployeeResponse[]> {
    let sql = `
      SELECT
        e.*,
        COALESCE(agg.lots_in_hand, 0)   AS lots_in_hand,
        COALESCE(agg.total_cts, 0)      AS total_cts,
        COALESCE(agg.total_issue, 0)    AS total_issue,
        COALESCE(agg.total_polished, 0) AS total_polished,
        COALESCE(sal.period_salary, 0)  AS period_salary,
        spec.codes                      AS specialist_codes
      FROM employees e
      LEFT JOIN (
        SELECT
          employee_id,
          SUM(CASE WHEN status IN ('ISSUED', 'IN_PROGRESS') THEN 1 ELSE 0 END) AS lots_in_hand,
          SUM(issue_weight) AS total_cts,
          SUM(CASE WHEN status IN ('RECEIVED', 'VERIFIED') THEN issue_weight ELSE 0 END) AS total_issue,
          SUM(CASE WHEN status IN ('RECEIVED', 'VERIFIED') THEN COALESCE(polished_wt, 0) ELSE 0 END) AS total_polished
        FROM lots
        WHERE deleted_at IS NULL
        GROUP BY employee_id
      ) agg ON agg.employee_id = e.id
      LEFT JOIN (
        SELECT sl.employee_id, sl.total_amount AS period_salary
        FROM salary_lines sl
        JOIN salary_periods sp ON sp.id = sl.period_id
        WHERE sp.status = 'OPEN' AND sp.deleted_at IS NULL
      ) sal ON sal.employee_id = e.id
      LEFT JOIN (
        SELECT employee_id, GROUP_CONCAT(specialist_code) AS codes
        FROM employee_specialists
        GROUP BY employee_id
      ) spec ON spec.employee_id = e.id
      WHERE e.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (workStatus && workStatus !== 'ALL') {
      sql += ' AND e.work_status = ?';
      params.push(workStatus);
    } else if (!workStatus) {
      sql += " AND e.work_status = 'WORKING'";
    }

    if (search) {
      sql += ' AND (e.full_name LIKE ? OR e.emp_code LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY e.full_name ASC';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.rowToResponse(r));
  }

  async findById(id: number): Promise<EmployeeResponse | null> {
    const rows = await this.query<EmployeeRow[]>(
      'SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (!rows[0]) return null;
    return this.toResponse(rows[0]);
  }

  async findRowById(id: number): Promise<EmployeeRow | null> {
    const rows = await this.query<EmployeeRow[]>(
      'SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] || null;
  }

  async findWorkingEmployees(): Promise<EmployeeRow[]> {
    return this.query<EmployeeRow[]>(
      "SELECT * FROM employees WHERE work_status = 'WORKING' AND deleted_at IS NULL ORDER BY full_name",
    );
  }

  /**
   * Employees who were on the payroll for any part of a window, including
   * those who resigned mid-period (they still earn their final salary).
   */
  async findEmployableInWindow(from: string, to: string, conn?: any): Promise<EmployeeRow[]> {
    const sql = `SELECT * FROM employees
                 WHERE deleted_at IS NULL
                   AND joined_at <= ?
                   AND (resigned_at IS NULL OR resigned_at >= ?)
                 ORDER BY full_name`;
    if (conn) {
      const [rows] = await conn.query(sql, [to, from]);
      return rows as EmployeeRow[];
    }
    return this.query<EmployeeRow[]>(sql, [to, from]);
  }

  async findByEmpCode(empCode: string): Promise<EmployeeRow | null> {
    const rows = await this.query<EmployeeRow[]>(
      'SELECT * FROM employees WHERE emp_code = ? AND deleted_at IS NULL',
      [empCode],
    );
    return rows[0] || null;
  }

  /** emp_code -> id lookup used by the punch importer. */
  async getEmpCodeMap(): Promise<Map<string, { id: number; shiftId: number | null }>> {
    const rows = await this.query<any[]>(
      "SELECT id, emp_code, shift_id FROM employees WHERE deleted_at IS NULL AND work_status = 'WORKING'",
    );
    const map = new Map<string, { id: number; shiftId: number | null }>();
    for (const r of rows) map.set(String(r.emp_code).trim().toUpperCase(), { id: r.id, shiftId: r.shift_id });
    return map;
  }

  async create(data: CreateEmployeeInput, userId: number, conn?: any): Promise<number> {
    const sql = `INSERT INTO employees
        (emp_code, full_name, short_name, grade, worker_type, work_status, whatsapp, joined_at,
         department, designation, monthly_salary, shift_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 'WORKING', ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      data.empCode,
      data.fullName,
      data.shortName,
      data.grade,
      data.workerType,
      data.whatsapp ?? null,
      data.joinedAt,
      data.department ?? null,
      data.designation ?? null,
      data.monthlySalary ?? null,
      data.shiftId ?? null,
      userId,
      userId,
    ];
    if (conn) {
      const [result] = await conn.query(sql, params);
      return (result as any).insertId;
    }
    const result = await this.query<any>(sql, params);
    return result.insertId;
  }

  async updateProfile(id: number, data: UpdateProfileInput, userId: number): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(PROFILE_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      if (BOOLEAN_NOT_NULL_KEYS.has(key as keyof UpdateProfileInput)) {
        params.push(toBool(value));
        continue;
      }
      params.push(value === '' ? null : value);
    }

    if (sets.length === 0) return;
    sets.push('updated_by = ?');
    params.push(userId, id);

    await this.query(`UPDATE employees SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
  }

  async markResigned(id: number, resignedAt: string, userId: number): Promise<void> {
    await this.query(
      "UPDATE employees SET work_status = 'RESIGN', resigned_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
      [resignedAt, userId, id],
    );
  }

  async getProfile(id: number): Promise<EmployeeFullProfileResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT e.*, s.name AS shift_name, m.full_name AS manager_name,
              hp.full_name AS hr_partner_name,
              (SELECT COUNT(*) FROM users u WHERE u.employee_id = e.id AND u.deleted_at IS NULL) AS login_count
       FROM employees e
       LEFT JOIN shifts s ON s.id = e.shift_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
       LEFT JOIN employees hp ON hp.id = e.hr_partner_id
       WHERE e.id = ? AND e.deleted_at IS NULL`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;

    return {
      employeeId: r.id,
      empCode: r.emp_code,
      fullName: r.full_name,
      shortName: r.short_name,
      grade: r.grade,
      workerType: r.worker_type,
      workStatus: r.work_status,
      whatsapp: r.whatsapp,
      joinedAt: toDateString(r.joined_at),
      resignedAt: r.resigned_at ? toDateString(r.resigned_at) : null,
      address: r.address,
      city: r.city,
      dob: r.dob ? toDateString(r.dob) : null,
      gender: r.gender,
      bloodGroup: r.blood_group,
      aadhaarMasked: maskAadhaar(r.aadhaar_number),
      hasAadhaar: !!r.aadhaar_number,
      pan: r.pan,
      bankName: r.bank_name,
      bankAccount: r.bank_account,
      bankIfsc: r.bank_ifsc,
      emergencyContactName: r.emergency_contact_name,
      emergencyContactPhone: r.emergency_contact_phone,
      photoUrl: r.photo_url,
      department: r.department,
      designation: r.designation,
      reportingManagerId: r.reporting_manager_id,
      reportingManagerName: r.manager_name,
      monthlySalary: r.monthly_salary === null ? null : Number(r.monthly_salary),
      pfApplicable: !!r.pf_applicable,
      esiApplicable: !!r.esi_applicable,
      shiftId: r.shift_id,
      shiftName: r.shift_name,
      hasLogin: Number(r.login_count) > 0,

      // --- Personal -----------------------------------------------------
      preferredName: r.preferred_name ?? null,
      maritalStatus: (r.marital_status ?? null) as MaritalStatus | null,
      nationality: r.nationality ?? null,
      religion: r.religion ?? null,
      hasDisability: !!r.has_disability,
      disabilityDetails: r.disability_details ?? null,
      biography: r.biography ?? null,

      // --- Identity -----------------------------------------------------
      passportNumber: null,
      passportMasked: maskPassport(r.passport_number ?? null),
      hasPassport: !!r.passport_number,
      passportExpiry: r.passport_expiry ? toDateString(r.passport_expiry) : null,
      visaNumber: r.visa_number ?? null,
      visaExpiry: r.visa_expiry ? toDateString(r.visa_expiry) : null,
      drivingLicense: r.driving_license ?? null,
      voterId: r.voter_id ?? null,
      taxId: r.tax_id ?? null,

      // --- Contact ------------------------------------------------------
      mobile: r.mobile ?? null,
      alternateMobile: r.alternate_mobile ?? null,
      personalEmail: r.personal_email ?? null,
      officialEmail: r.official_email ?? null,
      permanentAddress: r.permanent_address ?? null,
      state: r.state ?? null,
      country: r.country ?? null,
      postalCode: r.postal_code ?? null,
      contactPrefEmail: !!r.contact_pref_email,
      contactPrefSms: !!r.contact_pref_sms,
      contactPrefWhatsapp: !!r.contact_pref_whatsapp,

      // --- Emergency ----------------------------------------------------
      emergencyContactRelation: r.emergency_contact_relation ?? null,
      emergencyContactAddress: r.emergency_contact_address ?? null,
      emergencyAltName: r.emergency_alt_name ?? null,
      emergencyAltPhone: r.emergency_alt_phone ?? null,
      emergencyAltRelation: r.emergency_alt_relation ?? null,
      medicalContactName: r.medical_contact_name ?? null,
      medicalContactPhone: r.medical_contact_phone ?? null,

      // --- Employment ---------------------------------------------------
      employmentType: (r.employment_type ?? null) as EmploymentType | null,
      confirmationDate: r.confirmation_date ? toDateString(r.confirmation_date) : null,
      probationMonths: r.probation_months === null || r.probation_months === undefined
        ? null
        : Number(r.probation_months),
      noticePeriodDays: r.notice_period_days === null || r.notice_period_days === undefined
        ? null
        : Number(r.notice_period_days),
      retirementDate: r.retirement_date ? toDateString(r.retirement_date) : null,
      workLocation: r.work_location ?? null,
      officeLocation: r.office_location ?? null,
      jobRole: r.job_role ?? null,
      jobLevel: r.job_level ?? null,
      hrPartnerId: r.hr_partner_id ?? null,
      hrPartnerName: r.hr_partner_name ?? null,
      costCenter: r.cost_center ?? null,
      payrollGroup: r.payroll_group ?? null,

      // --- Organization -------------------------------------------------
      company: r.company ?? null,
      businessUnit: r.business_unit ?? null,
      division: r.division ?? null,
      section: r.section ?? null,
      team: r.team ?? null,
      branch: r.branch ?? null,
      region: r.region ?? null,
      legalEntity: r.legal_entity ?? null,

      // --- Bank / payroll -----------------------------------------------
      bankBranch: r.bank_branch ?? null,
      upiId: r.upi_id ?? null,
      isSalaryAccount: !!r.is_salary_account,
      payGrade: r.pay_grade ?? null,
      salaryStructure: r.salary_structure ?? null,
      gratuityApplicable: !!r.gratuity_applicable,
      insurancePolicyNo: r.insurance_policy_no ?? null,
      uanNumber: r.uan_number ?? null,
      esicNumber: r.esic_number ?? null,
    };
  }

  /** Employment placement plus the joined shift / manager / HR partner names. */
  async getEmploymentDetails(id: number): Promise<EmploymentDetailsResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT e.id, e.emp_code, e.work_status, e.employment_type, e.joined_at,
              e.confirmation_date, e.probation_months, e.notice_period_days,
              e.resigned_at, e.retirement_date, e.work_location, e.office_location,
              e.shift_id, e.grade, e.designation, e.job_role, e.job_level,
              e.reporting_manager_id, e.hr_partner_id, e.cost_center, e.payroll_group,
              s.name AS shift_name,
              m.full_name AS manager_name,
              hp.full_name AS hr_partner_name
       FROM employees e
       LEFT JOIN shifts s ON s.id = e.shift_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
       LEFT JOIN employees hp ON hp.id = e.hr_partner_id
       WHERE e.id = ? AND e.deleted_at IS NULL`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;

    const joinedAt = toDateString(r.joined_at);
    const exitDate = r.resigned_at ? toDateString(r.resigned_at) : null;

    return {
      employeeId: r.id,
      empCode: r.emp_code,
      employmentStatus: r.work_status,
      employmentType: (r.employment_type ?? null) as EmploymentType | null,
      joinedAt,
      confirmationDate: r.confirmation_date ? toDateString(r.confirmation_date) : null,
      probationMonths: r.probation_months === null || r.probation_months === undefined
        ? null
        : Number(r.probation_months),
      noticePeriodDays: r.notice_period_days === null || r.notice_period_days === undefined
        ? null
        : Number(r.notice_period_days),
      exitDate,
      retirementDate: r.retirement_date ? toDateString(r.retirement_date) : null,
      workLocation: r.work_location ?? null,
      officeLocation: r.office_location ?? null,
      shiftId: r.shift_id ?? null,
      shiftName: r.shift_name ?? null,
      grade: r.grade,
      designation: r.designation ?? null,
      jobRole: r.job_role ?? null,
      jobLevel: r.job_level ?? null,
      reportingManagerId: r.reporting_manager_id ?? null,
      reportingManagerName: r.manager_name ?? null,
      hrPartnerId: r.hr_partner_id ?? null,
      hrPartnerName: r.hr_partner_name ?? null,
      costCenter: r.cost_center ?? null,
      payrollGroup: r.payroll_group ?? null,
      tenureMonths: wholeMonthsBetween(joinedAt, exitDate ?? todayString()),
    };
  }

  async getOrganizationDetails(id: number): Promise<OrganizationDetailsResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT id, company, business_unit, division, department, section,
              team, branch, region, country, legal_entity
       FROM employees WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;

    return {
      employeeId: r.id,
      company: r.company ?? null,
      businessUnit: r.business_unit ?? null,
      division: r.division ?? null,
      department: r.department ?? null,
      section: r.section ?? null,
      team: r.team ?? null,
      branch: r.branch ?? null,
      region: r.region ?? null,
      country: r.country ?? null,
      legalEntity: r.legal_entity ?? null,
    };
  }

  /**
   * Per-section fill ratio driving the profile progress meter. Field lists are
   * fixed (see COMPLETENESS_SECTIONS) so the percentage is comparable over time.
   */
  async getProfileCompleteness(id: number): Promise<ProfileCompletenessRow[] | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    const r = rows[0];
    if (!r) return null;

    return COMPLETENESS_SECTIONS.map(({ section, columns }) => {
      const filled = columns.reduce((n, col) => n + (isFilled(r[col]) ? 1 : 0), 0);
      const total = columns.length;
      return {
        section,
        filled,
        total,
        pct: total === 0 ? 0 : Math.round((filled / total) * 100),
      };
    });
  }

  /** Lightweight people-directory listing — one query, no per-row lookups. */
  async getDirectory(filters: DirectoryFilters = {}): Promise<DirectoryEntry[]> {
    let sql = `SELECT id, emp_code, full_name, preferred_name, designation,
                      department, branch, photo_url, official_email, mobile
               FROM employees
               WHERE deleted_at IS NULL`;
    const params: any[] = [];

    const workStatus = filters.workStatus;
    if (workStatus && workStatus !== 'ALL') {
      sql += ' AND work_status = ?';
      params.push(workStatus);
    } else if (!workStatus) {
      sql += " AND work_status = 'WORKING'";
    }

    if (filters.search) {
      sql += ` AND (full_name LIKE ? OR preferred_name LIKE ? OR emp_code LIKE ?
                    OR designation LIKE ? OR official_email LIKE ?)`;
      const like = `%${filters.search}%`;
      params.push(like, like, like, like, like);
    }
    if (filters.department) {
      sql += ' AND department = ?';
      params.push(filters.department);
    }
    if (filters.branch) {
      sql += ' AND branch = ?';
      params.push(filters.branch);
    }
    if (filters.employmentType) {
      sql += ' AND employment_type = ?';
      params.push(filters.employmentType);
    }

    sql += ' ORDER BY full_name ASC';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      empCode: r.emp_code,
      fullName: r.full_name,
      preferredName: r.preferred_name ?? null,
      designation: r.designation ?? null,
      department: r.department ?? null,
      branch: r.branch ?? null,
      photoUrl: r.photo_url ?? null,
      officialEmail: r.official_email ?? null,
      mobile: r.mobile ?? null,
    }));
  }

  /** Headcount metrics used by the HR and executive dashboards. */
  async getHeadcountStats(): Promise<{
    total: number;
    working: number;
    resigned: number;
    joinedThisMonth: number;
    resignedThisMonth: number;
    withLogin: number;
  }> {
    const rows = await this.query<any[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(work_status = 'WORKING') AS working,
         SUM(work_status = 'RESIGN') AS resigned,
         SUM(joined_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS joined_this_month,
         SUM(resigned_at IS NOT NULL AND resigned_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS resigned_this_month,
         (SELECT COUNT(*) FROM users u WHERE u.employee_id IS NOT NULL AND u.deleted_at IS NULL) AS with_login
       FROM employees WHERE deleted_at IS NULL`,
    );
    const r = rows[0] ?? {};
    return {
      total: Number(r.total ?? 0),
      working: Number(r.working ?? 0),
      resigned: Number(r.resigned ?? 0),
      joinedThisMonth: Number(r.joined_this_month ?? 0),
      resignedThisMonth: Number(r.resigned_this_month ?? 0),
      withLogin: Number(r.with_login ?? 0),
    };
  }

  /** Upcoming birthdays and work anniversaries within the next `days` days. */
  async getUpcomingMilestones(days: number): Promise<{
    birthdays: { employeeId: number; name: string; empCode: string; date: string }[];
    anniversaries: { employeeId: number; name: string; empCode: string; date: string; years: number }[];
  }> {
    const birthdayRows = await this.query<any[]>(
      `SELECT id, full_name, emp_code, dob,
              DATE_FORMAT(dob, CONCAT(YEAR(CURDATE()), '-%m-%d')) AS this_year
       FROM employees
       WHERE deleted_at IS NULL AND work_status = 'WORKING' AND dob IS NOT NULL
       HAVING DATEDIFF(this_year, CURDATE()) BETWEEN 0 AND ?
       ORDER BY DATEDIFF(this_year, CURDATE())`,
      [days],
    );
    const anniversaryRows = await this.query<any[]>(
      `SELECT id, full_name, emp_code, joined_at,
              DATE_FORMAT(joined_at, CONCAT(YEAR(CURDATE()), '-%m-%d')) AS this_year,
              YEAR(CURDATE()) - YEAR(joined_at) AS years
       FROM employees
       WHERE deleted_at IS NULL AND work_status = 'WORKING'
       HAVING DATEDIFF(this_year, CURDATE()) BETWEEN 0 AND ? AND years > 0
       ORDER BY DATEDIFF(this_year, CURDATE())`,
      [days],
    );

    return {
      birthdays: birthdayRows.map((r) => ({
        employeeId: r.id,
        name: r.full_name,
        empCode: r.emp_code,
        date: toDateString(r.this_year),
      })),
      anniversaries: anniversaryRows.map((r) => ({
        employeeId: r.id,
        name: r.full_name,
        empCode: r.emp_code,
        date: toDateString(r.this_year),
        years: Number(r.years),
      })),
    };
  }

  async getSpecialists(employeeId: number): Promise<string[]> {
    const rows = await this.query<EmployeeSpecialistRow[]>(
      'SELECT specialist_code FROM employee_specialists WHERE employee_id = ?',
      [employeeId],
    );
    return rows.map((r) => r.specialist_code);
  }

  async getActiveLotCount(employeeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      "SELECT COUNT(*) as cnt FROM lots WHERE employee_id = ? AND status IN ('ISSUED', 'IN_PROGRESS') AND deleted_at IS NULL",
      [employeeId],
    );
    return rows[0]?.cnt ?? 0;
  }

  async getTotalCts(employeeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COALESCE(SUM(issue_weight), 0) as total FROM lots WHERE employee_id = ? AND deleted_at IS NULL',
      [employeeId],
    );
    return rows[0]?.total ?? 0;
  }

  async getYieldPct(employeeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT
        COALESCE(SUM(issue_weight), 0) as total_issue,
        COALESCE(SUM(polished_wt), 0) as total_polished
      FROM lots
      WHERE employee_id = ? AND status IN ('VERIFIED', 'RECEIVED') AND deleted_at IS NULL`,
      [employeeId],
    );
    const r = rows[0];
    if (!r || r.total_issue === 0) return 0;
    return Math.round((r.total_polished / r.total_issue) * 1000) / 10;
  }

  async getPeriodSalary(employeeId: number, periodId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT total_amount FROM salary_lines WHERE employee_id = ? AND period_id = ?',
      [employeeId, periodId],
    );
    return rows[0]?.total_amount ?? 0;
  }

  async getOpenPeriodSalary(employeeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT sl.total_amount FROM salary_lines sl
       JOIN salary_periods sp ON sl.period_id = sp.id
       WHERE sl.employee_id = ? AND sp.status = 'OPEN' AND sp.deleted_at IS NULL
       LIMIT 1`,
      [employeeId],
    );
    return rows[0]?.total_amount ?? 0;
  }

  /** Maps a row already carrying joined aggregates (no further queries). */
  private rowToResponse(r: any): EmployeeResponse {
    const totalIssue = Number(r.total_issue ?? 0);
    const totalPolished = Number(r.total_polished ?? 0);
    return {
      id: r.id,
      empCode: r.emp_code,
      fullName: r.full_name,
      shortName: r.short_name,
      grade: r.grade,
      specialist: r.specialist_codes ? String(r.specialist_codes).split(',') : [],
      workerType: r.worker_type,
      workStatus: r.work_status,
      lotsInHand: Number(r.lots_in_hand ?? 0),
      totalCts: Number(r.total_cts ?? 0),
      yieldPct: totalIssue === 0 ? 0 : Math.round((totalPolished / totalIssue) * 1000) / 10,
      periodSalary: Number(r.period_salary ?? 0),
      whatsapp: r.whatsapp,
      joinedAt: toDateString(r.joined_at),
      department: r.department ?? null,
      branch: r.branch ?? null,
      designation: r.designation ?? null,
    };
  }

  private async toResponse(row: EmployeeRow): Promise<EmployeeResponse> {
    const specialists = await this.getSpecialists(row.id);
    const lotsInHand = await this.getActiveLotCount(row.id);
    const totalCts = await this.getTotalCts(row.id);
    const yieldPct = await this.getYieldPct(row.id);
    const periodSalary = await this.getOpenPeriodSalary(row.id);

    return {
      id: row.id,
      empCode: row.emp_code,
      fullName: row.full_name,
      shortName: row.short_name,
      grade: row.grade,
      specialist: specialists,
      workerType: row.worker_type,
      workStatus: row.work_status,
      lotsInHand,
      totalCts,
      yieldPct,
      periodSalary,
      whatsapp: row.whatsapp,
      joinedAt: toDateString(row.joined_at),
      department: row.department ?? null,
      branch: (row as EmployeeRow & { branch?: string | null }).branch ?? null,
      designation: row.designation ?? null,
    };
  }
}

/** Aadhaar is stored in full but only ever leaves the server masked. */
export function maskAadhaar(value: string | null): string | null {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 4) return 'XXXX-XXXX-XXXX';
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

/** Passport numbers follow the same rule as Aadhaar: last 4 characters only. */
export function maskPassport(value: string | null): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (raw.length === 0) return null;
  if (raw.length <= 4) return `XXXX${raw.slice(-1)}`;
  return `${'X'.repeat(raw.length - 4)}${raw.slice(-4)}`;
}

/** MySQL hands booleans back as 0/1; forms send 'true'/'false'/''. */
function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

/** A value counts towards completeness only when it is really present. */
function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/** Whole calendar months between two `YYYY-MM-DD` dates (never negative). */
function wholeMonthsBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return 0;
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months > 0 ? months : 0;
}
