import { BaseRepository } from './BaseRepository';
import { maskAadhaar } from './EmployeeRepository';
import {
  CertificationResponse,
  CertificationType,
  EducationLevel,
  EducationResponse,
  EmployeeSettingsResponse,
  EmployeeSkillResponse,
  ExperienceLevel,
  ExperienceResponse,
  FamilyMemberResponse,
  FamilyRelation,
  GradeType,
  LanguageProficiency,
  LanguageResponse,
  OrgChartNode,
  PriorEmploymentType,
  ProfileVisibility,
  SkillCategory,
  SkillGapRow,
  SkillResponse,
  TimelineEventResponse,
  TimelineEventType,
} from '../types/profile';
import { addDays, toDateString, todayString } from '../utils/dateUtils';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
export interface FamilyInput {
  relation?: FamilyRelation;
  fullName?: string;
  dob?: string | null;
  occupation?: string | null;
  phone?: string | null;
  isDependent?: boolean;
  isNominee?: boolean;
  nomineeSharePct?: number | null;
  aadhaarNumber?: string | null;
  notes?: string | null;
}

export interface EducationInput {
  level?: EducationLevel;
  degree?: string | null;
  specialization?: string | null;
  institution?: string | null;
  boardUniversity?: string | null;
  passingYear?: number | null;
  gradeValue?: number | null;
  gradeType?: GradeType | null;
  documentId?: number | null;
  notes?: string | null;
}

export interface CertificationInput {
  name?: string;
  certType?: CertificationType;
  issuingAuthority?: string | null;
  credentialId?: string | null;
  issuedOn?: string | null;
  validUntil?: string | null;
  renewalDate?: string | null;
  documentId?: number | null;
  notes?: string | null;
}

export interface LanguageInput {
  language?: string;
  canRead?: boolean;
  canWrite?: boolean;
  canSpeak?: boolean;
  proficiency?: LanguageProficiency;
  isNative?: boolean;
}

export interface ExperienceInput {
  companyName?: string;
  designation?: string | null;
  employmentType?: PriorEmploymentType | null;
  industry?: string | null;
  location?: string | null;
  fromDate?: string;
  toDate?: string | null;
  isCurrent?: boolean;
  lastSalary?: number | null;
  reasonForLeaving?: string | null;
  projects?: string | null;
  referenceName?: string | null;
  referenceDesignation?: string | null;
  referencePhone?: string | null;
  referenceEmail?: string | null;
  documentId?: number | null;
}

export interface TimelineInput {
  eventType?: TimelineEventType;
  eventDate?: string;
  title?: string;
  details?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
  amount?: number | null;
  rating?: number | null;
  documentId?: number | null;
}

export interface CreateSkillInput {
  name: string;
  category?: SkillCategory;
  description?: string | null;
}

export interface EmployeeSkillInput {
  skillId: number;
  rating?: number;
  experienceLevel?: ExperienceLevel;
  yearsExperience?: number | null;
  lastUsedYear?: number | null;
  notes?: string | null;
}

export interface SettingsInput {
  profileVisibility?: ProfileVisibility;
  showContactToPeers?: boolean;
  showBirthday?: boolean;
  notifyLeave?: boolean;
  notifyPayroll?: boolean;
  notifyAttendance?: boolean;
  notifyAnnouncements?: boolean;
  notifyEmail?: boolean;
  language?: string;
  theme?: 'light' | 'dark' | 'system';
  dateFormat?: string;
  twoFactorEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Column maps — the only columns an update is ever allowed to write
// ---------------------------------------------------------------------------
const FAMILY_COLUMNS: Record<keyof FamilyInput, string> = {
  relation: 'relation',
  fullName: 'full_name',
  dob: 'dob',
  occupation: 'occupation',
  phone: 'phone',
  isDependent: 'is_dependent',
  isNominee: 'is_nominee',
  nomineeSharePct: 'nominee_share_pct',
  aadhaarNumber: 'aadhaar_number',
  notes: 'notes',
};

const EDUCATION_COLUMNS: Record<keyof EducationInput, string> = {
  level: 'level',
  degree: 'degree',
  specialization: 'specialization',
  institution: 'institution',
  boardUniversity: 'board_university',
  passingYear: 'passing_year',
  gradeValue: 'grade_value',
  gradeType: 'grade_type',
  documentId: 'document_id',
  notes: 'notes',
};

const CERTIFICATION_COLUMNS: Record<keyof CertificationInput, string> = {
  name: 'name',
  certType: 'cert_type',
  issuingAuthority: 'issuing_authority',
  credentialId: 'credential_id',
  issuedOn: 'issued_on',
  validUntil: 'valid_until',
  renewalDate: 'renewal_date',
  documentId: 'document_id',
  notes: 'notes',
};

const LANGUAGE_COLUMNS: Record<keyof LanguageInput, string> = {
  language: 'language',
  canRead: 'can_read',
  canWrite: 'can_write',
  canSpeak: 'can_speak',
  proficiency: 'proficiency',
  isNative: 'is_native',
};

const EXPERIENCE_COLUMNS: Record<keyof ExperienceInput, string> = {
  companyName: 'company_name',
  designation: 'designation',
  employmentType: 'employment_type',
  industry: 'industry',
  location: 'location',
  fromDate: 'from_date',
  toDate: 'to_date',
  isCurrent: 'is_current',
  lastSalary: 'last_salary',
  reasonForLeaving: 'reason_for_leaving',
  projects: 'projects',
  referenceName: 'reference_name',
  referenceDesignation: 'reference_designation',
  referencePhone: 'reference_phone',
  referenceEmail: 'reference_email',
  documentId: 'document_id',
};

const TIMELINE_COLUMNS: Record<keyof TimelineInput, string> = {
  eventType: 'event_type',
  eventDate: 'event_date',
  title: 'title',
  details: 'details',
  fromValue: 'from_value',
  toValue: 'to_value',
  amount: 'amount',
  rating: 'rating',
  documentId: 'document_id',
};

const SETTINGS_COLUMNS: Record<keyof SettingsInput, string> = {
  profileVisibility: 'profile_visibility',
  showContactToPeers: 'show_contact_to_peers',
  showBirthday: 'show_birthday',
  notifyLeave: 'notify_leave',
  notifyPayroll: 'notify_payroll',
  notifyAttendance: 'notify_attendance',
  notifyAnnouncements: 'notify_announcements',
  notifyEmail: 'notify_email',
  language: 'language',
  theme: 'theme',
  dateFormat: 'date_format',
  twoFactorEnabled: 'two_factor_enabled',
};

/** A certification inside this many days of expiry is flagged for renewal. */
const EXPIRY_WARNING_DAYS = 60;

/** Hard stop for any manager walk, so a data cycle can never hang a request. */
const MAX_CHAIN_DEPTH = 100;

/** Settings served when an employee has never saved preferences (mirrors the DDL). */
export function defaultSettings(employeeId: number): EmployeeSettingsResponse {
  return {
    employeeId,
    profileVisibility: 'TEAM',
    showContactToPeers: true,
    showBirthday: true,
    notifyLeave: true,
    notifyPayroll: true,
    notifyAttendance: true,
    notifyAnnouncements: true,
    notifyEmail: true,
    language: 'en',
    theme: 'system',
    dateFormat: 'DD-MM-YYYY',
    twoFactorEnabled: false,
  };
}

/**
 * Whole calendar months between two `YYYY-MM-DD` dates.
 * A partial month only counts once the day-of-month has been reached, so
 * 2024-01-31 → 2024-02-15 is 0 months, not 1.
 */
export function monthsBetween(from: string, to: string): number {
  const fromParts = from.split('-').map(Number);
  const toParts = to.split('-').map(Number);
  if (fromParts.length < 3 || toParts.length < 3) return 0;

  const [fy, fm, fd] = fromParts as [number, number, number];
  const [ty, tm, td] = toParts as [number, number, number];
  if ([fy, fm, fd, ty, tm, td].some((n) => !Number.isFinite(n))) return 0;

  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months > 0 ? months : 0;
}

/**
 * Every employee-profile sub-resource: family, education, skills,
 * certifications, languages, prior experience, career timeline, preferences
 * and the reporting hierarchy.
 *
 * Two rules hold across every section:
 *  - tables that carry `deleted_at` are soft-deleted and always filtered on it;
 *    `employee_languages` and `employee_skills` have no such column, so their
 *    removals are real DELETEs.
 *  - nothing here ever returns a raw Aadhaar number; family rows are masked on
 *    the way out by the same helper the employee profile uses.
 */
export class ProfileRepository extends BaseRepository {
  // =========================================================================
  // Shared helpers
  // =========================================================================
  /** Builds `col = ?` fragments for the keys the caller actually supplied. */
  private buildSets(
    columns: Record<string, string>,
    data: Record<string, unknown>,
  ): { sets: string[]; params: any[] } {
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      const value = data[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value === '' ? null : value);
    }
    return { sets, params };
  }

  /** INSERT built from a column -> value map; table names are always literals. */
  private async insertRow(table: string, values: Record<string, any>): Promise<number> {
    const columns = Object.keys(values);
    const sql = `INSERT INTO ${table} (${columns.join(', ')})
                 VALUES (${columns.map(() => '?').join(', ')})`;
    const result = await this.query<any>(
      sql,
      columns.map((c) => values[c]),
    );
    return Number(result.insertId);
  }

  /** Generic soft delete for the sub-resources that carry `deleted_at`. */
  private async softDelete(table: string, id: number): Promise<void> {
    await this.query(`UPDATE ${table} SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`, [
      id,
    ]);
  }

  private numOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private dateOrNull(value: unknown): string | null {
    return value === null || value === undefined || value === '' ? null : toDateString(value);
  }

  // =========================================================================
  // Family
  // =========================================================================
  async listFamily(employeeId: number): Promise<FamilyMemberResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM employee_family
       WHERE employee_id = ? AND deleted_at IS NULL
       ORDER BY FIELD(relation, 'SPOUSE', 'FATHER', 'MOTHER', 'CHILD', 'SIBLING', 'GUARDIAN', 'OTHER'),
                full_name ASC`,
      [employeeId],
    );
    return rows.map((r) => this.toFamily(r));
  }

  async findFamilyById(id: number): Promise<FamilyMemberResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM employee_family WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toFamily(rows[0]) : null;
  }

  async createFamily(employeeId: number, data: FamilyInput, userId: number): Promise<number> {
    return this.insertRow('employee_family', {
      employee_id: employeeId,
      relation: data.relation ?? 'OTHER',
      full_name: data.fullName ?? '',
      dob: data.dob ?? null,
      occupation: data.occupation ?? null,
      phone: data.phone ?? null,
      is_dependent: data.isDependent ? 1 : 0,
      is_nominee: data.isNominee ? 1 : 0,
      nominee_share_pct: data.nomineeSharePct ?? null,
      aadhaar_number: data.aadhaarNumber ?? null,
      notes: data.notes ?? null,
      created_by: userId,
      updated_by: userId,
    });
  }

  async updateFamily(id: number, data: FamilyInput, userId: number): Promise<void> {
    const { sets, params } = this.buildSets(FAMILY_COLUMNS, data as Record<string, unknown>);
    if (sets.length === 0) return;
    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(
      `UPDATE employee_family SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async removeFamily(id: number): Promise<void> {
    await this.softDelete('employee_family', id);
  }

  private toFamily(r: any): FamilyMemberResponse {
    return {
      id: r.id,
      employeeId: r.employee_id,
      relation: r.relation,
      fullName: r.full_name,
      dob: this.dateOrNull(r.dob),
      occupation: r.occupation ?? null,
      phone: r.phone ?? null,
      isDependent: !!r.is_dependent,
      isNominee: !!r.is_nominee,
      nomineeSharePct: this.numOrNull(r.nominee_share_pct),
      // Raw Aadhaar never leaves the server.
      aadhaarMasked: maskAadhaar(r.aadhaar_number ?? null),
      notes: r.notes ?? null,
    };
  }

  // =========================================================================
  // Education
  // =========================================================================
  async listEducation(employeeId: number): Promise<EducationResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM employee_education
       WHERE employee_id = ? AND deleted_at IS NULL
       ORDER BY passing_year DESC, id DESC`,
      [employeeId],
    );
    return rows.map((r) => this.toEducation(r));
  }

  async findEducationById(id: number): Promise<EducationResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM employee_education WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toEducation(rows[0]) : null;
  }

  async createEducation(employeeId: number, data: EducationInput, userId: number): Promise<number> {
    return this.insertRow('employee_education', {
      employee_id: employeeId,
      level: data.level ?? 'OTHER',
      degree: data.degree ?? null,
      specialization: data.specialization ?? null,
      institution: data.institution ?? null,
      board_university: data.boardUniversity ?? null,
      passing_year: data.passingYear ?? null,
      grade_value: data.gradeValue ?? null,
      grade_type: data.gradeType ?? null,
      document_id: data.documentId ?? null,
      notes: data.notes ?? null,
      created_by: userId,
      updated_by: userId,
    });
  }

  async updateEducation(id: number, data: EducationInput, userId: number): Promise<void> {
    const { sets, params } = this.buildSets(EDUCATION_COLUMNS, data as Record<string, unknown>);
    if (sets.length === 0) return;
    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(
      `UPDATE employee_education SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async removeEducation(id: number): Promise<void> {
    await this.softDelete('employee_education', id);
  }

  private toEducation(r: any): EducationResponse {
    return {
      id: r.id,
      employeeId: r.employee_id,
      level: r.level,
      degree: r.degree ?? null,
      specialization: r.specialization ?? null,
      institution: r.institution ?? null,
      boardUniversity: r.board_university ?? null,
      passingYear: this.numOrNull(r.passing_year),
      gradeValue: this.numOrNull(r.grade_value),
      gradeType: r.grade_type ?? null,
      documentId: this.numOrNull(r.document_id),
      notes: r.notes ?? null,
    };
  }

  // =========================================================================
  // Skills (master list, employee ratings and grade-target gap analysis)
  // =========================================================================
  async listSkills(category?: string): Promise<SkillResponse[]> {
    let sql = 'SELECT * FROM skills WHERE deleted_at IS NULL';
    const params: any[] = [];
    if (category && category !== 'ALL') {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY category ASC, name ASC';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toSkill(r));
  }

  async findSkillById(id: number): Promise<SkillResponse | null> {
    const rows = await this.query<any[]>('SELECT * FROM skills WHERE id = ? AND deleted_at IS NULL', [
      id,
    ]);
    return rows[0] ? this.toSkill(rows[0]) : null;
  }

  /** Case-insensitive lookup backing the duplicate-name rule. */
  async findSkillByName(name: string): Promise<SkillResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM skills WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL',
      [name.trim()],
    );
    return rows[0] ? this.toSkill(rows[0]) : null;
  }

  async createSkill(data: CreateSkillInput): Promise<number> {
    return this.insertRow('skills', {
      name: data.name.trim(),
      category: data.category ?? 'TECHNICAL',
      description: data.description ?? null,
    });
  }

  async listEmployeeSkills(employeeId: number): Promise<EmployeeSkillResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT es.*, s.name AS skill_name, s.category AS category
       FROM employee_skills es
       JOIN skills s ON s.id = es.skill_id AND s.deleted_at IS NULL
       WHERE es.employee_id = ?
       ORDER BY es.rating DESC, s.name ASC`,
      [employeeId],
    );
    return rows.map((r) => this.toEmployeeSkill(r));
  }

  async findEmployeeSkill(employeeId: number, skillId: number): Promise<EmployeeSkillResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT es.*, s.name AS skill_name, s.category AS category
       FROM employee_skills es
       JOIN skills s ON s.id = es.skill_id AND s.deleted_at IS NULL
       WHERE es.employee_id = ? AND es.skill_id = ?`,
      [employeeId, skillId],
    );
    return rows[0] ? this.toEmployeeSkill(rows[0]) : null;
  }

  /** Upsert on the (employee_id, skill_id) unique key — one rating per skill. */
  async setEmployeeSkill(
    employeeId: number,
    data: EmployeeSkillInput,
    userId: number,
  ): Promise<void> {
    await this.query(
      `INSERT INTO employee_skills
         (employee_id, skill_id, rating, experience_level, years_experience,
          last_used_year, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         rating = VALUES(rating),
         experience_level = VALUES(experience_level),
         years_experience = VALUES(years_experience),
         last_used_year = VALUES(last_used_year),
         notes = VALUES(notes),
         updated_by = VALUES(updated_by)`,
      [
        employeeId,
        data.skillId,
        data.rating ?? 3,
        data.experienceLevel ?? 'INTERMEDIATE',
        data.yearsExperience ?? null,
        data.lastUsedYear ?? null,
        data.notes ?? null,
        userId,
        userId,
      ],
    );
  }

  /** No `deleted_at` on employee_skills, so this is a real delete. */
  async removeEmployeeSkill(employeeId: number, skillId: number): Promise<void> {
    await this.query('DELETE FROM employee_skills WHERE employee_id = ? AND skill_id = ?', [
      employeeId,
      skillId,
    ]);
  }

  /**
   * Gap between the grade's target rating and what the employee actually holds.
   * Returns an empty array when the grade has no targets configured — callers
   * must report "unavailable" rather than reading zero gaps as a perfect score.
   */
  async getSkillGap(employeeId: number): Promise<SkillGapRow[]> {
    const gradeRows = await this.query<any[]>(
      'SELECT grade FROM employees WHERE id = ? AND deleted_at IS NULL',
      [employeeId],
    );
    const grade = gradeRows[0]?.grade;
    if (!grade) return [];

    const rows = await this.query<any[]>(
      `SELECT st.skill_id        AS skill_id,
              s.name             AS skill_name,
              s.category         AS category,
              st.target_rating   AS target_rating,
              COALESCE(es.rating, 0) AS current_rating
       FROM skill_targets st
       JOIN skills s ON s.id = st.skill_id AND s.deleted_at IS NULL
       LEFT JOIN employee_skills es ON es.skill_id = st.skill_id AND es.employee_id = ?
       WHERE st.grade = ?`,
      [employeeId, grade],
    );

    return rows
      .map((r) => {
        const targetRating = Number(r.target_rating ?? 0);
        const currentRating = Number(r.current_rating ?? 0);
        return {
          skillId: r.skill_id,
          skillName: r.skill_name,
          category: r.category as SkillCategory,
          targetRating,
          currentRating,
          gap: Math.max(0, targetRating - currentRating),
        };
      })
      .sort((a, b) => b.gap - a.gap || a.skillName.localeCompare(b.skillName));
  }

  private toSkill(r: any): SkillResponse {
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description ?? null,
    };
  }

  private toEmployeeSkill(r: any): EmployeeSkillResponse {
    return {
      id: r.id,
      employeeId: r.employee_id,
      skillId: r.skill_id,
      skillName: r.skill_name,
      category: r.category,
      rating: Number(r.rating ?? 0),
      experienceLevel: r.experience_level,
      yearsExperience: this.numOrNull(r.years_experience),
      lastUsedYear: this.numOrNull(r.last_used_year),
      notes: r.notes ?? null,
    };
  }

  // =========================================================================
  // Certifications
  // =========================================================================
  async listCertifications(employeeId: number): Promise<CertificationResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM employee_certifications
       WHERE employee_id = ? AND deleted_at IS NULL
       ORDER BY COALESCE(valid_until, issued_on) DESC, id DESC`,
      [employeeId],
    );
    return rows.map((r) => this.toCertification(r));
  }

  async findCertificationById(id: number): Promise<CertificationResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM employee_certifications WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toCertification(rows[0]) : null;
  }

  async createCertification(
    employeeId: number,
    data: CertificationInput,
    userId: number,
  ): Promise<number> {
    return this.insertRow('employee_certifications', {
      employee_id: employeeId,
      name: data.name ?? '',
      cert_type: data.certType ?? 'PROFESSIONAL',
      issuing_authority: data.issuingAuthority ?? null,
      credential_id: data.credentialId ?? null,
      issued_on: data.issuedOn ?? null,
      valid_until: data.validUntil ?? null,
      renewal_date: data.renewalDate ?? null,
      document_id: data.documentId ?? null,
      notes: data.notes ?? null,
      created_by: userId,
      updated_by: userId,
    });
  }

  async updateCertification(id: number, data: CertificationInput, userId: number): Promise<void> {
    const { sets, params } = this.buildSets(CERTIFICATION_COLUMNS, data as Record<string, unknown>);
    if (sets.length === 0) return;
    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(
      `UPDATE employee_certifications SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async removeCertification(id: number): Promise<void> {
    await this.softDelete('employee_certifications', id);
  }

  private toCertification(r: any): CertificationResponse {
    const validUntil = this.dateOrNull(r.valid_until);
    const today = todayString();
    const isExpired = validUntil !== null && validUntil < today;
    const expiringSoon =
      validUntil !== null && !isExpired && validUntil <= addDays(today, EXPIRY_WARNING_DAYS);

    return {
      id: r.id,
      employeeId: r.employee_id,
      name: r.name,
      certType: r.cert_type,
      issuingAuthority: r.issuing_authority ?? null,
      credentialId: r.credential_id ?? null,
      issuedOn: this.dateOrNull(r.issued_on),
      validUntil,
      renewalDate: this.dateOrNull(r.renewal_date),
      documentId: this.numOrNull(r.document_id),
      notes: r.notes ?? null,
      isExpired,
      expiringSoon,
    };
  }

  // =========================================================================
  // Languages
  // =========================================================================
  async listLanguages(employeeId: number): Promise<LanguageResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM employee_languages
       WHERE employee_id = ?
       ORDER BY is_native DESC, language ASC`,
      [employeeId],
    );
    return rows.map((r) => this.toLanguage(r));
  }

  async findLanguageById(id: number): Promise<LanguageResponse | null> {
    const rows = await this.query<any[]>('SELECT * FROM employee_languages WHERE id = ?', [id]);
    return rows[0] ? this.toLanguage(rows[0]) : null;
  }

  /** Backs the (employee_id, language) uniqueness check. */
  async findLanguageByName(employeeId: number, language: string): Promise<LanguageResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM employee_languages WHERE employee_id = ? AND LOWER(language) = LOWER(?)',
      [employeeId, language.trim()],
    );
    return rows[0] ? this.toLanguage(rows[0]) : null;
  }

  async createLanguage(employeeId: number, data: LanguageInput, userId: number): Promise<number> {
    return this.insertRow('employee_languages', {
      employee_id: employeeId,
      language: data.language ?? '',
      can_read: data.canRead ? 1 : 0,
      can_write: data.canWrite ? 1 : 0,
      can_speak: data.canSpeak ? 1 : 0,
      proficiency: data.proficiency ?? 'CONVERSATIONAL',
      is_native: data.isNative ? 1 : 0,
      created_by: userId,
      updated_by: userId,
    });
  }

  async updateLanguage(id: number, data: LanguageInput, userId: number): Promise<void> {
    const { sets, params } = this.buildSets(LANGUAGE_COLUMNS, data as Record<string, unknown>);
    if (sets.length === 0) return;
    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(`UPDATE employee_languages SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  /** No `deleted_at` on employee_languages, so this is a real delete. */
  async removeLanguage(id: number): Promise<void> {
    await this.query('DELETE FROM employee_languages WHERE id = ?', [id]);
  }

  private toLanguage(r: any): LanguageResponse {
    return {
      id: r.id,
      employeeId: r.employee_id,
      language: r.language,
      canRead: !!r.can_read,
      canWrite: !!r.can_write,
      canSpeak: !!r.can_speak,
      proficiency: r.proficiency,
      isNative: !!r.is_native,
    };
  }

  // =========================================================================
  // Prior experience
  // =========================================================================
  async listExperience(employeeId: number): Promise<ExperienceResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM employee_experience
       WHERE employee_id = ? AND deleted_at IS NULL
       ORDER BY from_date DESC, id DESC`,
      [employeeId],
    );
    return rows.map((r) => this.toExperience(r));
  }

  async findExperienceById(id: number): Promise<ExperienceResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM employee_experience WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toExperience(rows[0]) : null;
  }

  async createExperience(
    employeeId: number,
    data: ExperienceInput,
    userId: number,
  ): Promise<number> {
    return this.insertRow('employee_experience', {
      employee_id: employeeId,
      company_name: data.companyName ?? '',
      designation: data.designation ?? null,
      employment_type: data.employmentType ?? null,
      industry: data.industry ?? null,
      location: data.location ?? null,
      from_date: data.fromDate ?? null,
      to_date: data.toDate ?? null,
      is_current: data.isCurrent ? 1 : 0,
      last_salary: data.lastSalary ?? null,
      reason_for_leaving: data.reasonForLeaving ?? null,
      projects: data.projects ?? null,
      reference_name: data.referenceName ?? null,
      reference_designation: data.referenceDesignation ?? null,
      reference_phone: data.referencePhone ?? null,
      reference_email: data.referenceEmail ?? null,
      document_id: data.documentId ?? null,
      created_by: userId,
      updated_by: userId,
    });
  }

  async updateExperience(id: number, data: ExperienceInput, userId: number): Promise<void> {
    const { sets, params } = this.buildSets(EXPERIENCE_COLUMNS, data as Record<string, unknown>);
    if (sets.length === 0) return;
    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(
      `UPDATE employee_experience SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async removeExperience(id: number): Promise<void> {
    await this.softDelete('employee_experience', id);
  }

  private toExperience(r: any): ExperienceResponse {
    const fromDate = toDateString(r.from_date);
    const toDate = this.dateOrNull(r.to_date);
    return {
      id: r.id,
      employeeId: r.employee_id,
      companyName: r.company_name,
      designation: r.designation ?? null,
      employmentType: r.employment_type ?? null,
      industry: r.industry ?? null,
      location: r.location ?? null,
      fromDate,
      toDate,
      isCurrent: !!r.is_current,
      lastSalary: this.numOrNull(r.last_salary),
      reasonForLeaving: r.reason_for_leaving ?? null,
      projects: r.projects ?? null,
      referenceName: r.reference_name ?? null,
      referenceDesignation: r.reference_designation ?? null,
      referencePhone: r.reference_phone ?? null,
      referenceEmail: r.reference_email ?? null,
      documentId: this.numOrNull(r.document_id),
      months: monthsBetween(fromDate, toDate ?? todayString()),
    };
  }

  // =========================================================================
  // Career timeline
  // =========================================================================
  async listTimeline(employeeId: number): Promise<TimelineEventResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT t.*, u.name AS recorded_by_name
       FROM employee_timeline t
       LEFT JOIN users u ON u.id = t.recorded_by
       WHERE t.employee_id = ? AND t.deleted_at IS NULL
       ORDER BY t.event_date DESC, t.id DESC`,
      [employeeId],
    );
    return rows.map((r) => this.toTimeline(r));
  }

  async findTimelineById(id: number): Promise<TimelineEventResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT t.*, u.name AS recorded_by_name
       FROM employee_timeline t
       LEFT JOIN users u ON u.id = t.recorded_by
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.toTimeline(rows[0]) : null;
  }

  async createTimeline(employeeId: number, data: TimelineInput, userId: number): Promise<number> {
    // employee_timeline carries `recorded_by` instead of created_by/updated_by.
    return this.insertRow('employee_timeline', {
      employee_id: employeeId,
      event_type: data.eventType ?? 'OTHER',
      event_date: data.eventDate ?? null,
      title: data.title ?? '',
      details: data.details ?? null,
      from_value: data.fromValue ?? null,
      to_value: data.toValue ?? null,
      amount: data.amount ?? null,
      rating: data.rating ?? null,
      document_id: data.documentId ?? null,
      recorded_by: userId,
    });
  }

  async updateTimeline(id: number, data: TimelineInput, _userId: number): Promise<void> {
    // `_userId` keeps the signature uniform; the table has no updated_by column
    // and `recorded_by` deliberately stays with whoever first logged the event.
    const { sets, params } = this.buildSets(TIMELINE_COLUMNS, data as Record<string, unknown>);
    if (sets.length === 0) return;
    params.push(id);
    await this.query(
      `UPDATE employee_timeline SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async removeTimeline(id: number): Promise<void> {
    await this.softDelete('employee_timeline', id);
  }

  private toTimeline(r: any): TimelineEventResponse {
    return {
      id: r.id,
      employeeId: r.employee_id,
      eventType: r.event_type,
      eventDate: toDateString(r.event_date),
      title: r.title,
      details: r.details ?? null,
      fromValue: r.from_value ?? null,
      toValue: r.to_value ?? null,
      amount: this.numOrNull(r.amount),
      rating: this.numOrNull(r.rating),
      documentId: this.numOrNull(r.document_id),
      recordedBy: r.recorded_by_name ?? null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  // =========================================================================
  // Settings
  // =========================================================================
  /** Reads preferences without materialising a row; absent means defaults. */
  async getSettings(employeeId: number): Promise<EmployeeSettingsResponse> {
    const rows = await this.query<any[]>('SELECT * FROM employee_settings WHERE employee_id = ?', [
      employeeId,
    ]);
    const r = rows[0];
    if (!r) return defaultSettings(employeeId);

    return {
      employeeId: r.employee_id,
      profileVisibility: r.profile_visibility,
      showContactToPeers: !!r.show_contact_to_peers,
      showBirthday: !!r.show_birthday,
      notifyLeave: !!r.notify_leave,
      notifyPayroll: !!r.notify_payroll,
      notifyAttendance: !!r.notify_attendance,
      notifyAnnouncements: !!r.notify_announcements,
      notifyEmail: !!r.notify_email,
      language: r.language,
      theme: r.theme,
      dateFormat: r.date_format,
      twoFactorEnabled: !!r.two_factor_enabled,
    };
  }

  async upsertSettings(
    employeeId: number,
    data: SettingsInput,
    userId: number,
  ): Promise<void> {
    // Second line of defence: no code path may persist a 2FA flag that nothing
    // enforces. The service rejects it first with a user-facing message.
    if (data.twoFactorEnabled === true) {
      throw new Error(
        'Two-factor authentication is not available yet — no verification method is configured',
      );
    }

    const columns: string[] = ['employee_id'];
    const values: any[] = [employeeId];

    for (const [key, column] of Object.entries(SETTINGS_COLUMNS)) {
      const value = (data as Record<string, unknown>)[key];
      if (value === undefined) continue;
      columns.push(column);
      values.push(value);
    }
    columns.push('updated_by');
    values.push(userId);

    const updates = columns
      .filter((c) => c !== 'employee_id')
      .map((c) => `${c} = VALUES(${c})`)
      .join(', ');

    await this.query(
      `INSERT INTO employee_settings (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${updates}`,
      values,
    );
  }

  // =========================================================================
  // Org chart and reporting chain
  // =========================================================================
  /**
   * Builds the hierarchy from a single query. Employees whose manager is unset
   * or points outside the working set become roots; anyone caught in a manager
   * cycle is surfaced as a root too, so nobody silently disappears and the walk
   * can never recurse forever.
   */
  async getOrgChart(rootEmployeeId?: number): Promise<OrgChartNode[]> {
    const rows = await this.query<any[]>(
      `SELECT id, emp_code, full_name, designation, department, photo_url, reporting_manager_id
       FROM employees
       WHERE deleted_at IS NULL AND work_status = 'WORKING'
       ORDER BY full_name ASC`,
    );

    const present = new Set<number>(rows.map((r) => Number(r.id)));
    const childrenOf = new Map<number, number[]>();
    const byId = new Map<number, any>();
    const rootIds: number[] = [];

    for (const r of rows) {
      const id = Number(r.id);
      byId.set(id, r);
      const managerId =
        r.reporting_manager_id === null || r.reporting_manager_id === undefined
          ? null
          : Number(r.reporting_manager_id);

      if (managerId !== null && managerId !== id && present.has(managerId)) {
        const siblings = childrenOf.get(managerId);
        if (siblings) siblings.push(id);
        else childrenOf.set(managerId, [id]);
      } else {
        rootIds.push(id);
      }
    }

    const visited = new Set<number>();
    const build = (id: number): OrgChartNode | null => {
      if (visited.has(id)) return null; // cycle guard / already placed
      const row = byId.get(id);
      if (!row) return null;
      visited.add(id);

      const node: OrgChartNode = {
        employeeId: id,
        empCode: row.emp_code,
        fullName: row.full_name,
        designation: row.designation ?? null,
        department: row.department ?? null,
        photoUrl: row.photo_url ?? null,
        reports: [],
      };
      for (const childId of childrenOf.get(id) ?? []) {
        const child = build(childId);
        if (child) node.reports.push(child);
      }
      return node;
    };

    if (rootEmployeeId !== undefined) {
      const subtree = build(rootEmployeeId);
      return subtree ? [subtree] : [];
    }

    const tree: OrgChartNode[] = [];
    for (const id of rootIds) {
      const node = build(id);
      if (node) tree.push(node);
    }
    // Anything still unvisited sits inside a manager cycle; show it anyway.
    for (const id of byId.keys()) {
      if (visited.has(id)) continue;
      const node = build(id);
      if (node) tree.push(node);
    }
    return tree;
  }

  /** Managers above an employee, nearest first, stopping at a cycle or the top. */
  async getReportingChain(employeeId: number): Promise<OrgChartNode[]> {
    const chain: OrgChartNode[] = [];
    const seen = new Set<number>([employeeId]);
    let currentId = employeeId;

    for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth += 1) {
      const rows = await this.query<any[]>(
        `SELECT m.id, m.emp_code, m.full_name, m.designation, m.department, m.photo_url
         FROM employees e
         JOIN employees m ON m.id = e.reporting_manager_id AND m.deleted_at IS NULL
         WHERE e.id = ? AND e.deleted_at IS NULL`,
        [currentId],
      );
      const r = rows[0];
      if (!r) break;

      const managerId = Number(r.id);
      if (seen.has(managerId)) break; // cycle
      seen.add(managerId);

      chain.push({
        employeeId: managerId,
        empCode: r.emp_code,
        fullName: r.full_name,
        designation: r.designation ?? null,
        department: r.department ?? null,
        photoUrl: r.photo_url ?? null,
        reports: [],
      });
      currentId = managerId;
    }

    return chain;
  }
}
