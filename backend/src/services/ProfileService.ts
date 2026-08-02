import {
  CertificationInput,
  CreateSkillInput,
  EducationInput,
  EmployeeSkillInput,
  ExperienceInput,
  FamilyInput,
  LanguageInput,
  ProfileRepository,
  SettingsInput,
  TimelineInput,
  monthsBetween,
} from '../repositories/ProfileRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
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
import { EmployeeRow } from '../types';
import { isValidDateString, round2, toDateString, todayString } from '../utils/dateUtils';

const ENTITY = 'EMPLOYEE_PROFILE';

const RELATIONS: FamilyRelation[] = [
  'FATHER',
  'MOTHER',
  'SPOUSE',
  'CHILD',
  'SIBLING',
  'GUARDIAN',
  'OTHER',
];
const EDUCATION_LEVELS: EducationLevel[] = [
  'SCHOOL',
  'HIGHER_SECONDARY',
  'DIPLOMA',
  'GRADUATION',
  'POST_GRADUATION',
  'DOCTORATE',
  'OTHER',
];
const GRADE_TYPES: GradeType[] = ['PERCENTAGE', 'CGPA', 'GRADE'];
const SKILL_CATEGORIES: SkillCategory[] = ['TECHNICAL', 'FUNCTIONAL', 'SOFT'];
const EXPERIENCE_LEVELS: ExperienceLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];
const CERT_TYPES: CertificationType[] = ['PROFESSIONAL', 'TECHNICAL', 'LICENSE', 'OTHER'];
const PROFICIENCIES: LanguageProficiency[] = [
  'BASIC',
  'CONVERSATIONAL',
  'PROFICIENT',
  'FLUENT',
  'NATIVE',
];
const PRIOR_EMPLOYMENT_TYPES: PriorEmploymentType[] = [
  'PERMANENT',
  'CONTRACT',
  'PART_TIME',
  'INTERNSHIP',
  'FREELANCE',
];
const TIMELINE_TYPES: TimelineEventType[] = [
  'JOINED',
  'CONFIRMED',
  'PROMOTION',
  'TRANSFER',
  'SALARY_REVISION',
  'AWARD',
  'DISCIPLINARY',
  'PERFORMANCE_REVIEW',
  'TRAINING',
  'EXIT',
  'OTHER',
];
const VISIBILITIES: ProfileVisibility[] = ['EVERYONE', 'TEAM', 'HR_ONLY'];
const THEMES: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];

const EARLIEST_PASSING_YEAR = 1950;

/** Skill-gap analysis plus an honest answer when no targets are configured. */
export interface SkillGapResult {
  employeeId: number;
  grade: string;
  available: boolean;
  message: string | null;
  rows: SkillGapRow[];
}

export interface ExperienceSummary {
  employeeId: number;
  priorMonths: number;
  currentTenureMonths: number;
  totalMonths: number;
  totalYears: number;
  display: string;
}

export class ProfileService {
  private repo = new ProfileRepository();
  private employees = new EmployeeRepository();
  private activity = new ActivityRepository();

  // =========================================================================
  // Shared helpers
  // =========================================================================
  private async requireEmployee(employeeId: number): Promise<EmployeeRow> {
    if (!Number.isFinite(employeeId) || employeeId <= 0) throw new Error('Employee not found');
    const employee = await this.employees.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');
    return employee;
  }

  private async logChange(
    employeeId: number,
    entityId: number,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    summary: string,
    userId: number,
    actorName: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await this.activity.log({
      actorUserId: userId,
      actorName,
      employeeId,
      entityType: ENTITY,
      entityId,
      action,
      summary,
      meta: meta ?? null,
    });
  }

  /** Trimmed string, or null when blank/absent. */
  private text(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return s === '' ? null : s;
  }

  private optionalDate(value: unknown, label: string): string | null {
    if (value === null || value === undefined || value === '') return null;
    const s = toDateString(value);
    if (!isValidDateString(s)) throw new Error(`${label} must be a valid YYYY-MM-DD date`);
    return s;
  }

  private requiredDate(value: unknown, label: string): string {
    const s = this.optionalDate(value, label);
    if (!s) throw new Error(`${label} is required`);
    return s;
  }

  private optionalNumber(value: unknown, label: string): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
    return n;
  }

  private enumValue<T extends string>(value: unknown, allowed: T[], label: string): T {
    const s = String(value ?? '').trim().toUpperCase();
    const match = allowed.find((a) => a === s);
    if (!match) throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
    return match;
  }

  // =========================================================================
  // Family
  // =========================================================================
  async listFamily(employeeId: number): Promise<FamilyMemberResponse[]> {
    await this.requireEmployee(employeeId);
    return this.repo.listFamily(employeeId);
  }

  async createFamily(
    employeeId: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<FamilyMemberResponse> {
    const employee = await this.requireEmployee(employeeId);

    const fullName = this.text(body.fullName);
    if (!fullName) throw new Error('A family member name is required');
    const relation = this.enumValue(body.relation, RELATIONS, 'Relation');

    const isNominee = !!body.isNominee;
    const nomineeSharePct = this.nomineeShare(body.nomineeSharePct);
    await this.assertNomineeShare(employeeId, null, isNominee, nomineeSharePct);

    const data: FamilyInput = {
      relation,
      fullName,
      dob: this.optionalDate(body.dob, 'Date of birth'),
      occupation: this.text(body.occupation),
      phone: this.text(body.phone),
      isDependent: !!body.isDependent,
      isNominee,
      nomineeSharePct,
      aadhaarNumber: this.aadhaar(body.aadhaarNumber),
      notes: this.text(body.notes),
    };

    const id = await this.repo.createFamily(employeeId, data, userId);
    await this.logChange(
      employeeId,
      id,
      'CREATE',
      `Added family member ${fullName} (${relation}) for ${employee.full_name}`,
      userId,
      actorName,
    );

    const created = await this.repo.findFamilyById(id);
    if (!created) throw new Error('Family member could not be created');
    return created;
  }

  async updateFamily(
    id: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<FamilyMemberResponse> {
    const existing = await this.repo.findFamilyById(id);
    if (!existing) throw new Error('Family member not found');

    const data: FamilyInput = {};

    if (body.fullName !== undefined) {
      const fullName = this.text(body.fullName);
      if (!fullName) throw new Error('A family member name is required');
      data.fullName = fullName;
    }
    if (body.relation !== undefined) data.relation = this.enumValue(body.relation, RELATIONS, 'Relation');
    if (body.dob !== undefined) data.dob = this.optionalDate(body.dob, 'Date of birth');
    if (body.occupation !== undefined) data.occupation = this.text(body.occupation);
    if (body.phone !== undefined) data.phone = this.text(body.phone);
    if (body.isDependent !== undefined) data.isDependent = !!body.isDependent;
    if (body.isNominee !== undefined) data.isNominee = !!body.isNominee;
    if (body.nomineeSharePct !== undefined) data.nomineeSharePct = this.nomineeShare(body.nomineeSharePct);
    if (body.aadhaarNumber !== undefined) data.aadhaarNumber = this.aadhaar(body.aadhaarNumber);
    if (body.notes !== undefined) data.notes = this.text(body.notes);

    const isNominee = data.isNominee ?? existing.isNominee;
    const share = data.nomineeSharePct !== undefined ? data.nomineeSharePct : existing.nomineeSharePct;
    await this.assertNomineeShare(existing.employeeId, id, isNominee, share);

    await this.repo.updateFamily(id, data, userId);
    await this.logChange(
      existing.employeeId,
      id,
      'UPDATE',
      `Updated family member ${data.fullName ?? existing.fullName}`,
      userId,
      actorName,
    );

    const updated = await this.repo.findFamilyById(id);
    if (!updated) throw new Error('Family member not found');
    return updated;
  }

  async deleteFamily(id: number, userId: number, actorName: string): Promise<void> {
    const existing = await this.repo.findFamilyById(id);
    if (!existing) throw new Error('Family member not found');

    await this.repo.removeFamily(id);
    await this.logChange(
      existing.employeeId,
      id,
      'DELETE',
      `Removed family member ${existing.fullName} (${existing.relation})`,
      userId,
      actorName,
    );
  }

  private nomineeShare(value: unknown): number | null {
    const pct = this.optionalNumber(value, 'Nominee share');
    if (pct === null) return null;
    if (pct < 0 || pct > 100) throw new Error('Nominee share must be between 0 and 100');
    return round2(pct);
  }

  /** Aadhaar is stored raw but never returned; keep only the 12 digits. */
  private aadhaar(value: unknown): string | null {
    const raw = this.text(value);
    if (raw === null) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.length !== 12) throw new Error('Aadhaar number must be 12 digits');
    return digits;
  }

  /** Nominee shares are a division of one benefit; they can never exceed 100%. */
  private async assertNomineeShare(
    employeeId: number,
    excludeId: number | null,
    isNominee: boolean,
    share: number | null,
  ): Promise<void> {
    if (!isNominee) return;

    const members = await this.repo.listFamily(employeeId);
    let total = share ?? 0;
    for (const m of members) {
      if (excludeId !== null && m.id === excludeId) continue;
      if (!m.isNominee) continue;
      total += m.nomineeSharePct ?? 0;
    }
    if (round2(total) > 100) {
      throw new Error('Nominee share across all nominees cannot exceed 100%');
    }
  }

  // =========================================================================
  // Education
  // =========================================================================
  async listEducation(employeeId: number): Promise<EducationResponse[]> {
    await this.requireEmployee(employeeId);
    return this.repo.listEducation(employeeId);
  }

  async createEducation(
    employeeId: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<EducationResponse> {
    const employee = await this.requireEmployee(employeeId);
    const level = this.enumValue(body.level, EDUCATION_LEVELS, 'Education level');
    const gradeType =
      body.gradeType === undefined || body.gradeType === null || body.gradeType === ''
        ? null
        : this.enumValue(body.gradeType, GRADE_TYPES, 'Grade type');

    const data: EducationInput = {
      level,
      degree: this.text(body.degree),
      specialization: this.text(body.specialization),
      institution: this.text(body.institution),
      boardUniversity: this.text(body.boardUniversity),
      passingYear: this.passingYear(body.passingYear),
      gradeValue: this.gradeValue(body.gradeValue, gradeType),
      gradeType,
      documentId: this.optionalNumber(body.documentId, 'Document id'),
      notes: this.text(body.notes),
    };

    const id = await this.repo.createEducation(employeeId, data, userId);
    await this.logChange(
      employeeId,
      id,
      'CREATE',
      `Added ${level} qualification${data.degree ? ` (${data.degree})` : ''} for ${employee.full_name}`,
      userId,
      actorName,
    );

    const created = await this.repo.findEducationById(id);
    if (!created) throw new Error('Education record could not be created');
    return created;
  }

  async updateEducation(
    id: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<EducationResponse> {
    const existing = await this.repo.findEducationById(id);
    if (!existing) throw new Error('Education record not found');

    const data: EducationInput = {};

    if (body.level !== undefined) data.level = this.enumValue(body.level, EDUCATION_LEVELS, 'Education level');
    if (body.degree !== undefined) data.degree = this.text(body.degree);
    if (body.specialization !== undefined) data.specialization = this.text(body.specialization);
    if (body.institution !== undefined) data.institution = this.text(body.institution);
    if (body.boardUniversity !== undefined) data.boardUniversity = this.text(body.boardUniversity);
    if (body.passingYear !== undefined) data.passingYear = this.passingYear(body.passingYear);
    if (body.documentId !== undefined) data.documentId = this.optionalNumber(body.documentId, 'Document id');
    if (body.notes !== undefined) data.notes = this.text(body.notes);

    if (body.gradeType !== undefined) {
      data.gradeType =
        body.gradeType === null || body.gradeType === ''
          ? null
          : this.enumValue(body.gradeType, GRADE_TYPES, 'Grade type');
    }
    if (body.gradeValue !== undefined) {
      const effectiveType = data.gradeType !== undefined ? data.gradeType : existing.gradeType;
      data.gradeValue = this.gradeValue(body.gradeValue, effectiveType);
    }

    await this.repo.updateEducation(id, data, userId);
    await this.logChange(
      existing.employeeId,
      id,
      'UPDATE',
      `Updated ${data.level ?? existing.level} qualification`,
      userId,
      actorName,
    );

    const updated = await this.repo.findEducationById(id);
    if (!updated) throw new Error('Education record not found');
    return updated;
  }

  async deleteEducation(id: number, userId: number, actorName: string): Promise<void> {
    const existing = await this.repo.findEducationById(id);
    if (!existing) throw new Error('Education record not found');

    await this.repo.removeEducation(id);
    await this.logChange(
      existing.employeeId,
      id,
      'DELETE',
      `Removed ${existing.level} qualification${existing.degree ? ` (${existing.degree})` : ''}`,
      userId,
      actorName,
    );
  }

  private passingYear(value: unknown): number | null {
    const year = this.optionalNumber(value, 'Passing year');
    if (year === null) return null;
    const maxYear = new Date().getUTCFullYear() + 1;
    if (!Number.isInteger(year) || year < EARLIEST_PASSING_YEAR || year > maxYear) {
      throw new Error(`Passing year must be between ${EARLIEST_PASSING_YEAR} and ${maxYear}`);
    }
    return year;
  }

  private gradeValue(value: unknown, gradeType: GradeType | null): number | null {
    const grade = this.optionalNumber(value, 'Grade');
    if (grade === null) return null;
    if (grade < 0) throw new Error('Grade cannot be negative');
    if (gradeType === 'PERCENTAGE' && grade > 100) {
      throw new Error('A percentage grade cannot exceed 100');
    }
    return round2(grade);
  }

  // =========================================================================
  // Skills
  // =========================================================================
  async listSkills(category?: string): Promise<SkillResponse[]> {
    const filter =
      category && category !== 'ALL'
        ? this.enumValue(category, SKILL_CATEGORIES, 'Skill category')
        : undefined;
    return this.repo.listSkills(filter);
  }

  async createSkill(body: Record<string, unknown>, userId: number, actorName: string): Promise<SkillResponse> {
    const name = this.text(body.name);
    if (!name) throw new Error('A skill name is required');

    const clash = await this.repo.findSkillByName(name);
    if (clash) throw new Error(`Skill "${clash.name}" already exists`);

    const data: CreateSkillInput = {
      name,
      category:
        body.category === undefined || body.category === null || body.category === ''
          ? 'TECHNICAL'
          : this.enumValue(body.category, SKILL_CATEGORIES, 'Skill category'),
      description: this.text(body.description),
    };

    const id = await this.repo.createSkill(data);
    await this.activity.log({
      actorUserId: userId,
      actorName,
      entityType: ENTITY,
      entityId: id,
      action: 'CREATE',
      summary: `Added skill "${name}" (${data.category})`,
    });

    const created = await this.repo.findSkillById(id);
    if (!created) throw new Error('Skill could not be created');
    return created;
  }

  async listEmployeeSkills(employeeId: number): Promise<EmployeeSkillResponse[]> {
    await this.requireEmployee(employeeId);
    return this.repo.listEmployeeSkills(employeeId);
  }

  async setEmployeeSkill(
    employeeId: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<EmployeeSkillResponse> {
    const employee = await this.requireEmployee(employeeId);

    const skillId = this.optionalNumber(body.skillId, 'Skill id');
    if (skillId === null || !Number.isInteger(skillId) || skillId <= 0) {
      throw new Error('A valid skillId is required');
    }
    const skill = await this.repo.findSkillById(skillId);
    if (!skill) throw new Error('Skill not found');

    const rating = body.rating === undefined ? 3 : this.optionalNumber(body.rating, 'Rating');
    if (rating === null || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    const yearsExperience = this.optionalNumber(body.yearsExperience, 'Years of experience');
    if (yearsExperience !== null && (yearsExperience < 0 || yearsExperience > 60)) {
      throw new Error('Years of experience must be between 0 and 60');
    }

    const lastUsedYear = this.optionalNumber(body.lastUsedYear, 'Last used year');
    const maxYear = new Date().getUTCFullYear();
    if (
      lastUsedYear !== null &&
      (!Number.isInteger(lastUsedYear) || lastUsedYear < EARLIEST_PASSING_YEAR || lastUsedYear > maxYear)
    ) {
      throw new Error(`Last used year must be between ${EARLIEST_PASSING_YEAR} and ${maxYear}`);
    }

    const data: EmployeeSkillInput = {
      skillId,
      rating,
      experienceLevel:
        body.experienceLevel === undefined || body.experienceLevel === null || body.experienceLevel === ''
          ? 'INTERMEDIATE'
          : this.enumValue(body.experienceLevel, EXPERIENCE_LEVELS, 'Experience level'),
      yearsExperience: yearsExperience === null ? null : round2(yearsExperience),
      lastUsedYear,
      notes: this.text(body.notes),
    };

    await this.repo.setEmployeeSkill(employeeId, data, userId);
    await this.logChange(
      employeeId,
      skillId,
      'UPDATE',
      `Set ${employee.full_name}'s "${skill.name}" skill rating to ${rating}/5`,
      userId,
      actorName,
    );

    const saved = await this.repo.findEmployeeSkill(employeeId, skillId);
    if (!saved) throw new Error('Skill rating could not be saved');
    return saved;
  }

  async deleteEmployeeSkill(
    employeeId: number,
    skillId: number,
    userId: number,
    actorName: string,
  ): Promise<void> {
    await this.requireEmployee(employeeId);
    const existing = await this.repo.findEmployeeSkill(employeeId, skillId);
    if (!existing) throw new Error('Skill rating not found');

    await this.repo.removeEmployeeSkill(employeeId, skillId);
    await this.logChange(
      employeeId,
      skillId,
      'DELETE',
      `Removed "${existing.skillName}" from the skill profile`,
      userId,
      actorName,
    );
  }

  /**
   * Never claims a perfect score by accident: with no targets configured for the
   * employee's grade there is nothing to compare against, and the caller is told
   * so explicitly instead of receiving an empty (zero-gap) list.
   */
  async getSkillGap(employeeId: number): Promise<SkillGapResult> {
    const employee = await this.requireEmployee(employeeId);
    const rows = await this.repo.getSkillGap(employeeId);

    if (rows.length === 0) {
      return {
        employeeId,
        grade: employee.grade,
        available: false,
        message: `No skill targets are configured for grade ${employee.grade}, so gap analysis is unavailable`,
        rows: [],
      };
    }

    return { employeeId, grade: employee.grade, available: true, message: null, rows };
  }

  // =========================================================================
  // Certifications
  // =========================================================================
  async listCertifications(employeeId: number): Promise<CertificationResponse[]> {
    await this.requireEmployee(employeeId);
    return this.repo.listCertifications(employeeId);
  }

  async createCertification(
    employeeId: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<CertificationResponse> {
    const employee = await this.requireEmployee(employeeId);

    const name = this.text(body.name);
    if (!name) throw new Error('A certification name is required');

    const issuedOn = this.optionalDate(body.issuedOn, 'Issue date');
    const validUntil = this.optionalDate(body.validUntil, 'Valid until date');
    if (issuedOn && validUntil && validUntil <= issuedOn) {
      throw new Error('The valid-until date must be after the issue date');
    }

    const data: CertificationInput = {
      name,
      certType:
        body.certType === undefined || body.certType === null || body.certType === ''
          ? 'PROFESSIONAL'
          : this.enumValue(body.certType, CERT_TYPES, 'Certification type'),
      issuingAuthority: this.text(body.issuingAuthority),
      credentialId: this.text(body.credentialId),
      issuedOn,
      validUntil,
      renewalDate: this.optionalDate(body.renewalDate, 'Renewal date'),
      documentId: this.optionalNumber(body.documentId, 'Document id'),
      notes: this.text(body.notes),
    };

    const id = await this.repo.createCertification(employeeId, data, userId);
    await this.logChange(
      employeeId,
      id,
      'CREATE',
      `Added certification "${name}" for ${employee.full_name}`,
      userId,
      actorName,
    );

    const created = await this.repo.findCertificationById(id);
    if (!created) throw new Error('Certification could not be created');
    return created;
  }

  async updateCertification(
    id: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<CertificationResponse> {
    const existing = await this.repo.findCertificationById(id);
    if (!existing) throw new Error('Certification not found');

    const data: CertificationInput = {};

    if (body.name !== undefined) {
      const name = this.text(body.name);
      if (!name) throw new Error('A certification name is required');
      data.name = name;
    }
    if (body.certType !== undefined) {
      data.certType = this.enumValue(body.certType, CERT_TYPES, 'Certification type');
    }
    if (body.issuingAuthority !== undefined) data.issuingAuthority = this.text(body.issuingAuthority);
    if (body.credentialId !== undefined) data.credentialId = this.text(body.credentialId);
    if (body.issuedOn !== undefined) data.issuedOn = this.optionalDate(body.issuedOn, 'Issue date');
    if (body.validUntil !== undefined) data.validUntil = this.optionalDate(body.validUntil, 'Valid until date');
    if (body.renewalDate !== undefined) data.renewalDate = this.optionalDate(body.renewalDate, 'Renewal date');
    if (body.documentId !== undefined) data.documentId = this.optionalNumber(body.documentId, 'Document id');
    if (body.notes !== undefined) data.notes = this.text(body.notes);

    const issuedOn = data.issuedOn !== undefined ? data.issuedOn : existing.issuedOn;
    const validUntil = data.validUntil !== undefined ? data.validUntil : existing.validUntil;
    if (issuedOn && validUntil && validUntil <= issuedOn) {
      throw new Error('The valid-until date must be after the issue date');
    }

    await this.repo.updateCertification(id, data, userId);
    await this.logChange(
      existing.employeeId,
      id,
      'UPDATE',
      `Updated certification "${data.name ?? existing.name}"`,
      userId,
      actorName,
    );

    const updated = await this.repo.findCertificationById(id);
    if (!updated) throw new Error('Certification not found');
    return updated;
  }

  async deleteCertification(id: number, userId: number, actorName: string): Promise<void> {
    const existing = await this.repo.findCertificationById(id);
    if (!existing) throw new Error('Certification not found');

    await this.repo.removeCertification(id);
    await this.logChange(
      existing.employeeId,
      id,
      'DELETE',
      `Removed certification "${existing.name}"`,
      userId,
      actorName,
    );
  }

  // =========================================================================
  // Languages
  // =========================================================================
  async listLanguages(employeeId: number): Promise<LanguageResponse[]> {
    await this.requireEmployee(employeeId);
    return this.repo.listLanguages(employeeId);
  }

  async createLanguage(
    employeeId: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<LanguageResponse> {
    const employee = await this.requireEmployee(employeeId);

    const language = this.text(body.language);
    if (!language) throw new Error('A language is required');

    const canRead = !!body.canRead;
    const canWrite = !!body.canWrite;
    const canSpeak = !!body.canSpeak;
    if (!canRead && !canWrite && !canSpeak) {
      throw new Error('Select at least one of read, write or speak');
    }

    const clash = await this.repo.findLanguageByName(employeeId, language);
    if (clash) throw new Error(`${clash.language} is already listed for this employee`);

    const data: LanguageInput = {
      language,
      canRead,
      canWrite,
      canSpeak,
      proficiency:
        body.proficiency === undefined || body.proficiency === null || body.proficiency === ''
          ? 'CONVERSATIONAL'
          : this.enumValue(body.proficiency, PROFICIENCIES, 'Proficiency'),
      isNative: !!body.isNative,
    };

    const id = await this.repo.createLanguage(employeeId, data, userId);
    await this.logChange(
      employeeId,
      id,
      'CREATE',
      `Added language ${language} for ${employee.full_name}`,
      userId,
      actorName,
    );

    const created = await this.repo.findLanguageById(id);
    if (!created) throw new Error('Language could not be created');
    return created;
  }

  async updateLanguage(
    id: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<LanguageResponse> {
    const existing = await this.repo.findLanguageById(id);
    if (!existing) throw new Error('Language not found');

    const data: LanguageInput = {};

    if (body.language !== undefined) {
      const language = this.text(body.language);
      if (!language) throw new Error('A language is required');
      const clash = await this.repo.findLanguageByName(existing.employeeId, language);
      if (clash && clash.id !== id) {
        throw new Error(`${clash.language} is already listed for this employee`);
      }
      data.language = language;
    }
    if (body.canRead !== undefined) data.canRead = !!body.canRead;
    if (body.canWrite !== undefined) data.canWrite = !!body.canWrite;
    if (body.canSpeak !== undefined) data.canSpeak = !!body.canSpeak;
    if (body.isNative !== undefined) data.isNative = !!body.isNative;
    if (body.proficiency !== undefined) {
      data.proficiency = this.enumValue(body.proficiency, PROFICIENCIES, 'Proficiency');
    }

    const canRead = data.canRead ?? existing.canRead;
    const canWrite = data.canWrite ?? existing.canWrite;
    const canSpeak = data.canSpeak ?? existing.canSpeak;
    if (!canRead && !canWrite && !canSpeak) {
      throw new Error('Select at least one of read, write or speak');
    }

    await this.repo.updateLanguage(id, data, userId);
    await this.logChange(
      existing.employeeId,
      id,
      'UPDATE',
      `Updated language ${data.language ?? existing.language}`,
      userId,
      actorName,
    );

    const updated = await this.repo.findLanguageById(id);
    if (!updated) throw new Error('Language not found');
    return updated;
  }

  async deleteLanguage(id: number, userId: number, actorName: string): Promise<void> {
    const existing = await this.repo.findLanguageById(id);
    if (!existing) throw new Error('Language not found');

    await this.repo.removeLanguage(id);
    await this.logChange(
      existing.employeeId,
      id,
      'DELETE',
      `Removed language ${existing.language}`,
      userId,
      actorName,
    );
  }

  // =========================================================================
  // Prior experience
  // =========================================================================
  async listExperience(employeeId: number): Promise<ExperienceResponse[]> {
    await this.requireEmployee(employeeId);
    return this.repo.listExperience(employeeId);
  }

  async createExperience(
    employeeId: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<ExperienceResponse> {
    const employee = await this.requireEmployee(employeeId);

    const companyName = this.text(body.companyName);
    if (!companyName) throw new Error('A company name is required');

    const fromDate = this.requiredDate(body.fromDate, 'From date');
    if (fromDate > todayString()) throw new Error('From date cannot be in the future');

    const toDate = this.optionalDate(body.toDate, 'To date');
    const isCurrent = !!body.isCurrent;
    this.assertExperienceDates(fromDate, toDate, isCurrent);

    const data: ExperienceInput = {
      companyName,
      designation: this.text(body.designation),
      employmentType:
        body.employmentType === undefined || body.employmentType === null || body.employmentType === ''
          ? null
          : this.enumValue(body.employmentType, PRIOR_EMPLOYMENT_TYPES, 'Employment type'),
      industry: this.text(body.industry),
      location: this.text(body.location),
      fromDate,
      toDate,
      isCurrent,
      lastSalary: this.nonNegative(body.lastSalary, 'Last salary'),
      reasonForLeaving: this.text(body.reasonForLeaving),
      projects: this.text(body.projects),
      referenceName: this.text(body.referenceName),
      referenceDesignation: this.text(body.referenceDesignation),
      referencePhone: this.text(body.referencePhone),
      referenceEmail: this.text(body.referenceEmail),
      documentId: this.optionalNumber(body.documentId, 'Document id'),
    };

    const id = await this.repo.createExperience(employeeId, data, userId);
    await this.logChange(
      employeeId,
      id,
      'CREATE',
      `Added prior experience at ${companyName} for ${employee.full_name}`,
      userId,
      actorName,
    );

    const created = await this.repo.findExperienceById(id);
    if (!created) throw new Error('Experience record could not be created');
    return created;
  }

  async updateExperience(
    id: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<ExperienceResponse> {
    const existing = await this.repo.findExperienceById(id);
    if (!existing) throw new Error('Experience record not found');

    const data: ExperienceInput = {};

    if (body.companyName !== undefined) {
      const companyName = this.text(body.companyName);
      if (!companyName) throw new Error('A company name is required');
      data.companyName = companyName;
    }
    if (body.fromDate !== undefined) {
      const fromDate = this.requiredDate(body.fromDate, 'From date');
      if (fromDate > todayString()) throw new Error('From date cannot be in the future');
      data.fromDate = fromDate;
    }
    if (body.toDate !== undefined) data.toDate = this.optionalDate(body.toDate, 'To date');
    if (body.isCurrent !== undefined) data.isCurrent = !!body.isCurrent;
    if (body.designation !== undefined) data.designation = this.text(body.designation);
    if (body.employmentType !== undefined) {
      data.employmentType =
        body.employmentType === null || body.employmentType === ''
          ? null
          : this.enumValue(body.employmentType, PRIOR_EMPLOYMENT_TYPES, 'Employment type');
    }
    if (body.industry !== undefined) data.industry = this.text(body.industry);
    if (body.location !== undefined) data.location = this.text(body.location);
    if (body.lastSalary !== undefined) data.lastSalary = this.nonNegative(body.lastSalary, 'Last salary');
    if (body.reasonForLeaving !== undefined) data.reasonForLeaving = this.text(body.reasonForLeaving);
    if (body.projects !== undefined) data.projects = this.text(body.projects);
    if (body.referenceName !== undefined) data.referenceName = this.text(body.referenceName);
    if (body.referenceDesignation !== undefined) {
      data.referenceDesignation = this.text(body.referenceDesignation);
    }
    if (body.referencePhone !== undefined) data.referencePhone = this.text(body.referencePhone);
    if (body.referenceEmail !== undefined) data.referenceEmail = this.text(body.referenceEmail);
    if (body.documentId !== undefined) data.documentId = this.optionalNumber(body.documentId, 'Document id');

    this.assertExperienceDates(
      data.fromDate ?? existing.fromDate,
      data.toDate !== undefined ? data.toDate : existing.toDate,
      data.isCurrent ?? existing.isCurrent,
    );

    await this.repo.updateExperience(id, data, userId);
    await this.logChange(
      existing.employeeId,
      id,
      'UPDATE',
      `Updated prior experience at ${data.companyName ?? existing.companyName}`,
      userId,
      actorName,
    );

    const updated = await this.repo.findExperienceById(id);
    if (!updated) throw new Error('Experience record not found');
    return updated;
  }

  async deleteExperience(id: number, userId: number, actorName: string): Promise<void> {
    const existing = await this.repo.findExperienceById(id);
    if (!existing) throw new Error('Experience record not found');

    await this.repo.removeExperience(id);
    await this.logChange(
      existing.employeeId,
      id,
      'DELETE',
      `Removed prior experience at ${existing.companyName}`,
      userId,
      actorName,
    );
  }

  private assertExperienceDates(fromDate: string, toDate: string | null, isCurrent: boolean): void {
    if (isCurrent && toDate) throw new Error('A current role cannot have a leaving date');
    if (toDate && toDate <= fromDate) throw new Error('To date must be after the from date');
  }

  private nonNegative(value: unknown, label: string): number | null {
    const n = this.optionalNumber(value, label);
    if (n === null) return null;
    if (n < 0) throw new Error(`${label} cannot be negative`);
    return round2(n);
  }

  /** Prior employment plus tenure at this company, in whole months. */
  async getTotalExperienceMonths(employeeId: number): Promise<number> {
    const summary = await this.getExperienceSummary(employeeId);
    return summary.totalMonths;
  }

  async getExperienceSummary(employeeId: number): Promise<ExperienceSummary> {
    const employee = await this.requireEmployee(employeeId);
    const prior = await this.repo.listExperience(employeeId);

    const priorMonths = prior.reduce((sum, e) => sum + e.months, 0);
    const joinedAt = toDateString(employee.joined_at);
    const until = employee.resigned_at ? toDateString(employee.resigned_at) : todayString();
    const currentTenureMonths = isValidDateString(joinedAt) ? monthsBetween(joinedAt, until) : 0;
    const totalMonths = priorMonths + currentTenureMonths;

    return {
      employeeId,
      priorMonths,
      currentTenureMonths,
      totalMonths,
      totalYears: round2(totalMonths / 12),
      display: `${Math.floor(totalMonths / 12)}y ${totalMonths % 12}m`,
    };
  }

  // =========================================================================
  // Career timeline
  // =========================================================================
  async listTimeline(employeeId: number): Promise<TimelineEventResponse[]> {
    await this.requireEmployee(employeeId);
    return this.repo.listTimeline(employeeId);
  }

  async createTimeline(
    employeeId: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<TimelineEventResponse> {
    const employee = await this.requireEmployee(employeeId);

    const eventType = this.enumValue(body.eventType, TIMELINE_TYPES, 'Event type');
    const eventDate = this.requiredDate(body.eventDate, 'Event date');
    if (eventDate > todayString()) throw new Error('Timeline events cannot be dated in the future');

    const title = this.text(body.title);
    if (!title) throw new Error('An event title is required');

    const data: TimelineInput = {
      eventType,
      eventDate,
      title,
      details: this.text(body.details),
      fromValue: this.text(body.fromValue),
      toValue: this.text(body.toValue),
      amount: this.optionalNumber(body.amount, 'Amount'),
      rating: this.rating(body.rating),
      documentId: this.optionalNumber(body.documentId, 'Document id'),
    };

    const id = await this.repo.createTimeline(employeeId, data, userId);
    await this.logChange(
      employeeId,
      id,
      'CREATE',
      `Logged ${eventType} event "${title}" on ${eventDate} for ${employee.full_name}`,
      userId,
      actorName,
    );

    const created = await this.repo.findTimelineById(id);
    if (!created) throw new Error('Timeline event could not be created');
    return created;
  }

  async updateTimeline(
    id: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<TimelineEventResponse> {
    const existing = await this.repo.findTimelineById(id);
    if (!existing) throw new Error('Timeline event not found');

    const data: TimelineInput = {};

    if (body.eventType !== undefined) {
      data.eventType = this.enumValue(body.eventType, TIMELINE_TYPES, 'Event type');
    }
    if (body.eventDate !== undefined) {
      const eventDate = this.requiredDate(body.eventDate, 'Event date');
      if (eventDate > todayString()) throw new Error('Timeline events cannot be dated in the future');
      data.eventDate = eventDate;
    }
    if (body.title !== undefined) {
      const title = this.text(body.title);
      if (!title) throw new Error('An event title is required');
      data.title = title;
    }
    if (body.details !== undefined) data.details = this.text(body.details);
    if (body.fromValue !== undefined) data.fromValue = this.text(body.fromValue);
    if (body.toValue !== undefined) data.toValue = this.text(body.toValue);
    if (body.amount !== undefined) data.amount = this.optionalNumber(body.amount, 'Amount');
    if (body.rating !== undefined) data.rating = this.rating(body.rating);
    if (body.documentId !== undefined) data.documentId = this.optionalNumber(body.documentId, 'Document id');

    await this.repo.updateTimeline(id, data, userId);
    await this.logChange(
      existing.employeeId,
      id,
      'UPDATE',
      `Updated timeline event "${data.title ?? existing.title}"`,
      userId,
      actorName,
    );

    const updated = await this.repo.findTimelineById(id);
    if (!updated) throw new Error('Timeline event not found');
    return updated;
  }

  async deleteTimeline(id: number, userId: number, actorName: string): Promise<void> {
    const existing = await this.repo.findTimelineById(id);
    if (!existing) throw new Error('Timeline event not found');

    await this.repo.removeTimeline(id);
    await this.logChange(
      existing.employeeId,
      id,
      'DELETE',
      `Removed timeline event "${existing.title}" (${existing.eventDate})`,
      userId,
      actorName,
    );
  }

  private rating(value: unknown): number | null {
    const n = this.optionalNumber(value, 'Rating');
    if (n === null) return null;
    if (n < 0 || n > 10) throw new Error('Rating must be between 0 and 10');
    return round2(n);
  }

  // =========================================================================
  // Settings
  // =========================================================================
  async getSettings(employeeId: number): Promise<EmployeeSettingsResponse> {
    await this.requireEmployee(employeeId);
    return this.repo.getSettings(employeeId);
  }

  async updateSettings(
    employeeId: number,
    body: Record<string, unknown>,
    userId: number,
    actorName: string,
  ): Promise<EmployeeSettingsResponse> {
    await this.requireEmployee(employeeId);

    // Refused outright: the column exists but nothing in this system can verify
    // a second factor, so storing `true` would advertise protection that is not
    // there. Better an absent flag than a decorative one.
    if (body.twoFactorEnabled === true || String(body.twoFactorEnabled) === 'true') {
      throw new Error(
        'Two-factor authentication is not available yet — no verification method is configured',
      );
    }

    const data: SettingsInput = {};

    if (body.profileVisibility !== undefined) {
      data.profileVisibility = this.enumValue(body.profileVisibility, VISIBILITIES, 'Profile visibility');
    }
    if (body.showContactToPeers !== undefined) data.showContactToPeers = !!body.showContactToPeers;
    if (body.showBirthday !== undefined) data.showBirthday = !!body.showBirthday;
    if (body.notifyLeave !== undefined) data.notifyLeave = !!body.notifyLeave;
    if (body.notifyPayroll !== undefined) data.notifyPayroll = !!body.notifyPayroll;
    if (body.notifyAttendance !== undefined) data.notifyAttendance = !!body.notifyAttendance;
    if (body.notifyAnnouncements !== undefined) data.notifyAnnouncements = !!body.notifyAnnouncements;
    if (body.notifyEmail !== undefined) data.notifyEmail = !!body.notifyEmail;
    if (body.twoFactorEnabled !== undefined) data.twoFactorEnabled = false;

    if (body.language !== undefined) {
      const language = this.text(body.language);
      if (!language) throw new Error('A language code is required');
      if (language.length > 10) throw new Error('Language code cannot exceed 10 characters');
      data.language = language;
    }
    if (body.theme !== undefined) {
      const theme = String(body.theme ?? '').trim().toLowerCase();
      const match = THEMES.find((t) => t === theme);
      if (!match) throw new Error(`Theme must be one of: ${THEMES.join(', ')}`);
      data.theme = match;
    }
    if (body.dateFormat !== undefined) {
      const dateFormat = this.text(body.dateFormat);
      if (!dateFormat) throw new Error('A date format is required');
      if (dateFormat.length > 20) throw new Error('Date format cannot exceed 20 characters');
      data.dateFormat = dateFormat;
    }

    await this.repo.upsertSettings(employeeId, data, userId);
    await this.logChange(employeeId, employeeId, 'UPDATE', 'Updated profile preferences', userId, actorName, {
      keys: Object.keys(data),
    });

    return this.repo.getSettings(employeeId);
  }

  // =========================================================================
  // Org chart
  // =========================================================================
  async getOrgChart(): Promise<OrgChartNode[]> {
    return this.repo.getOrgChart();
  }

  async getOrgChartFor(rootEmployeeId: number): Promise<OrgChartNode> {
    await this.requireEmployee(rootEmployeeId);
    const tree = await this.repo.getOrgChart(rootEmployeeId);
    const root = tree[0];
    if (!root) throw new Error('This employee is not part of the active org chart');
    return root;
  }

  async getReportingChain(employeeId: number): Promise<OrgChartNode[]> {
    await this.requireEmployee(employeeId);
    return this.repo.getReportingChain(employeeId);
  }
}
