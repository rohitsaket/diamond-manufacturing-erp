import {
  EmployeeRepository,
  CreateEmployeeInput,
  UpdateProfileInput,
  DirectoryFilters,
} from '../repositories/EmployeeRepository';
import { LotRepository } from '../repositories/LotRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { isValidDateString } from '../utils/dateUtils';
import { FullProfileResponse, EmploymentType, MaritalStatus } from '../types/profile';

const WORKER_TYPES = ['PIECE_RATE', 'DHAR', 'MAXI'];
const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
const MARITAL_STATUSES: MaritalStatus[] = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'OTHER'];
const EMPLOYMENT_TYPES: EmploymentType[] = ['PERMANENT', 'CONTRACT', 'PROBATION', 'TRAINEE', 'CONSULTANT'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The slice of the profile aggregate owned by this service. Family, education,
 * skills, certifications, languages, experience, timeline and settings are
 * sub-resources served by their own endpoints.
 */
export type CoreFullProfileResponse = Omit<
  FullProfileResponse,
  'family' | 'education' | 'skills' | 'certifications' | 'languages' | 'experience' | 'timeline' | 'settings'
>;

export class EmployeeService {
  private empRepo = new EmployeeRepository();
  private lotRepo = new LotRepository();
  private activityRepo = new ActivityRepository();

  async findAll(search?: string, workStatus?: string) {
    return this.empRepo.findAll(search, workStatus);
  }

  async findById(id: number) {
    return this.empRepo.findById(id);
  }

  async getEmployeeLots(employeeId: number) {
    const { rows } = await this.lotRepo.findAll({ employeeId, limit: 100 });
    return rows;
  }

  async getProfile(id: number) {
    const profile = await this.empRepo.getProfile(id);
    if (!profile) throw new Error('Employee not found');
    return profile;
  }

  async getEmploymentDetails(id: number) {
    const details = await this.empRepo.getEmploymentDetails(id);
    if (!details) throw new Error('Employee not found');
    return details;
  }

  async getOrganizationDetails(id: number) {
    const org = await this.empRepo.getOrganizationDetails(id);
    if (!org) throw new Error('Employee not found');
    return org;
  }

  async getProfileCompleteness(id: number) {
    const rows = await this.empRepo.getProfileCompleteness(id);
    if (!rows) throw new Error('Employee not found');
    return rows;
  }

  async getDirectory(filters: DirectoryFilters = {}) {
    return this.empRepo.getDirectory(filters);
  }

  /**
   * Everything the profile page needs from the core employee record, grouped
   * into the sections the UI renders. Sub-resources (family, education, …) are
   * fetched from their own endpoints, so their arrays come back empty here.
   */
  async getFullProfile(id: number): Promise<CoreFullProfileResponse> {
    const [p, employment, organization, completeness] = await Promise.all([
      this.empRepo.getProfile(id),
      this.empRepo.getEmploymentDetails(id),
      this.empRepo.getOrganizationDetails(id),
      this.empRepo.getProfileCompleteness(id),
    ]);
    if (!p || !employment || !organization || !completeness) throw new Error('Employee not found');

    // Built as a plain object so the empty sub-resource arrays can still ship on
    // the wire while the declared return type stays limited to what we own.
    const result = {
      personal: {
        employeeId: p.employeeId,
        empCode: p.empCode,
        fullName: p.fullName,
        shortName: p.shortName,
        preferredName: p.preferredName,
        dob: p.dob,
        gender: p.gender,
        maritalStatus: p.maritalStatus,
        bloodGroup: p.bloodGroup,
        nationality: p.nationality,
        religion: p.religion,
        hasDisability: p.hasDisability,
        disabilityDetails: p.disabilityDetails,
        biography: p.biography,
        photoUrl: p.photoUrl,
        aadhaarMasked: p.aadhaarMasked,
        hasAadhaar: p.hasAadhaar,
        pan: p.pan,
        passportMasked: p.passportMasked,
        hasPassport: p.hasPassport,
        passportExpiry: p.passportExpiry,
        visaNumber: p.visaNumber,
        visaExpiry: p.visaExpiry,
        drivingLicense: p.drivingLicense,
        voterId: p.voterId,
        taxId: p.taxId,
      },
      contact: {
        mobile: p.mobile,
        alternateMobile: p.alternateMobile,
        whatsapp: p.whatsapp,
        personalEmail: p.personalEmail,
        officialEmail: p.officialEmail,
        address: p.address,
        permanentAddress: p.permanentAddress,
        city: p.city,
        state: p.state,
        country: p.country,
        postalCode: p.postalCode,
        contactPrefEmail: p.contactPrefEmail,
        contactPrefSms: p.contactPrefSms,
        contactPrefWhatsapp: p.contactPrefWhatsapp,
        emergencyContactName: p.emergencyContactName,
        emergencyContactPhone: p.emergencyContactPhone,
        emergencyContactRelation: p.emergencyContactRelation,
        emergencyContactAddress: p.emergencyContactAddress,
        emergencyAltName: p.emergencyAltName,
        emergencyAltPhone: p.emergencyAltPhone,
        emergencyAltRelation: p.emergencyAltRelation,
        medicalContactName: p.medicalContactName,
        medicalContactPhone: p.medicalContactPhone,
      },
      employment,
      organization,
      bank: {
        bankName: p.bankName,
        bankAccount: p.bankAccount,
        bankIfsc: p.bankIfsc,
        bankBranch: p.bankBranch,
        upiId: p.upiId,
        isSalaryAccount: p.isSalaryAccount,
      },
      payroll: {
        monthlySalary: p.monthlySalary,
        payGrade: p.payGrade,
        salaryStructure: p.salaryStructure,
        costCenter: p.costCenter,
        payrollGroup: p.payrollGroup,
        pfApplicable: p.pfApplicable,
        esiApplicable: p.esiApplicable,
        gratuityApplicable: p.gratuityApplicable,
        insurancePolicyNo: p.insurancePolicyNo,
        uanNumber: p.uanNumber,
        esicNumber: p.esicNumber,
      },
      family: [],
      education: [],
      skills: [],
      certifications: [],
      languages: [],
      experience: [],
      timeline: [],
      completeness,
    };

    return result;
  }

  /** Replaces the profile photo with an already-stored multer upload. */
  async updatePhoto(id: number, file: Express.Multer.File, userId: number, actorName?: string) {
    if (!file) throw new Error('A photo file is required');
    if (!file.mimetype.startsWith('image/')) throw new Error('The profile photo must be an image file');

    const employee = await this.empRepo.findRowById(id);
    if (!employee) throw new Error('Employee not found');

    await this.empRepo.updateProfile(id, { photoUrl: file.filename }, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      employeeId: id,
      entityType: 'employee',
      entityId: id,
      action: 'PHOTO_UPDATED',
      summary: `${actorName ?? 'Someone'} updated the profile photo of ${employee.full_name}`,
    });

    return this.empRepo.getProfile(id);
  }

  async create(data: CreateEmployeeInput, userId: number, actorName: string) {
    if (!data.empCode?.trim()) throw new Error('Employee code is required');
    if (!data.fullName?.trim()) throw new Error('Full name is required');
    if (!data.grade?.trim()) throw new Error('Grade is required');
    if (!WORKER_TYPES.includes(data.workerType)) {
      throw new Error(`Worker type must be one of ${WORKER_TYPES.join(', ')}`);
    }
    if (!data.joinedAt || !isValidDateString(data.joinedAt)) {
      throw new Error('A valid joining date is required (YYYY-MM-DD)');
    }

    const empCode = data.empCode.trim().toUpperCase();
    const existing = await this.empRepo.findByEmpCode(empCode);
    if (existing) throw new Error(`Employee code ${empCode} is already in use`);

    const shortName = data.shortName?.trim() || (data.fullName.trim().split(/\s+/)[0] as string);
    const id = await this.empRepo.create({ ...data, empCode, shortName }, userId);

    await this.activityRepo.log({
      actorUserId: userId,
      actorName,
      employeeId: id,
      entityType: 'employee',
      entityId: id,
      action: 'CREATED',
      summary: `${actorName} added employee ${data.fullName} (${empCode})`,
    });

    return this.empRepo.getProfile(id);
  }

  async updateProfile(id: number, data: UpdateProfileInput, userId: number, actorName: string) {
    const employee = await this.empRepo.findRowById(id);
    if (!employee) throw new Error('Employee not found');

    if (data.aadhaarNumber) {
      const digits = String(data.aadhaarNumber).replace(/\D/g, '');
      if (digits.length !== 12) throw new Error('Aadhaar number must be 12 digits');
      data.aadhaarNumber = digits;
    }
    if (data.pan) {
      const pan = String(data.pan).toUpperCase().trim();
      if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) throw new Error('PAN must look like ABCDE1234F');
      data.pan = pan;
    }
    if (data.bankIfsc) {
      const ifsc = String(data.bankIfsc).toUpperCase().trim();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new Error('IFSC code is not valid');
      data.bankIfsc = ifsc;
    }
    if (data.dob && !isValidDateString(data.dob)) throw new Error('Date of birth must be YYYY-MM-DD');
    if (data.gender && !GENDERS.includes(String(data.gender))) {
      throw new Error(`Gender must be one of ${GENDERS.join(', ')}`);
    }
    if (data.monthlySalary !== undefined && data.monthlySalary !== null && Number(data.monthlySalary) < 0) {
      throw new Error('Monthly salary cannot be negative');
    }
    if (data.reportingManagerId && Number(data.reportingManagerId) === id) {
      throw new Error('An employee cannot report to themselves');
    }

    // --- Extended profile validation ----------------------------------------
    if (data.personalEmail) {
      const email = String(data.personalEmail).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw new Error('Personal email is not a valid email address');
      data.personalEmail = email;
    }
    if (data.officialEmail) {
      const email = String(data.officialEmail).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw new Error('Official email is not a valid email address');
      data.officialEmail = email;
    }
    if (data.postalCode) {
      const code = String(data.postalCode).trim();
      if (!/^\d{6}$/.test(code)) throw new Error('Postal code must be 6 digits');
      data.postalCode = code;
    }
    for (const [field, label] of [
      ['passportExpiry', 'Passport expiry'],
      ['visaExpiry', 'Visa expiry'],
      ['confirmationDate', 'Confirmation date'],
      ['retirementDate', 'Retirement date'],
    ] as const) {
      const value = data[field];
      if (value && !isValidDateString(String(value))) {
        throw new Error(`${label} must be YYYY-MM-DD`);
      }
    }
    if (data.probationMonths !== undefined && data.probationMonths !== null && data.probationMonths !== ('' as any)) {
      const months = Number(data.probationMonths);
      if (!Number.isFinite(months) || months < 0 || months > 36) {
        throw new Error('Probation months must be between 0 and 36');
      }
      data.probationMonths = months;
    }
    if (data.noticePeriodDays !== undefined && data.noticePeriodDays !== null && data.noticePeriodDays !== ('' as any)) {
      const days = Number(data.noticePeriodDays);
      if (!Number.isFinite(days) || days < 0 || days > 180) {
        throw new Error('Notice period must be between 0 and 180 days');
      }
      data.noticePeriodDays = days;
    }
    if (data.nationality && String(data.nationality).trim().length > 80) {
      throw new Error('Nationality cannot exceed 80 characters');
    }
    if (data.religion && String(data.religion).trim().length > 80) {
      throw new Error('Religion cannot exceed 80 characters');
    }
    if (data.hrPartnerId && Number(data.hrPartnerId) === id) {
      throw new Error('An employee cannot be their own HR partner');
    }
    if (data.maritalStatus) {
      const status = String(data.maritalStatus).toUpperCase() as MaritalStatus;
      if (!MARITAL_STATUSES.includes(status)) {
        throw new Error(`Marital status must be one of ${MARITAL_STATUSES.join(', ')}`);
      }
      data.maritalStatus = status;
    }
    if (data.employmentType) {
      const type = String(data.employmentType).toUpperCase() as EmploymentType;
      if (!EMPLOYMENT_TYPES.includes(type)) {
        throw new Error(`Employment type must be one of ${EMPLOYMENT_TYPES.join(', ')}`);
      }
      data.employmentType = type;
    }

    await this.empRepo.updateProfile(id, data, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      actorName,
      employeeId: id,
      entityType: 'employee',
      entityId: id,
      action: 'PROFILE_UPDATED',
      summary: `${actorName} updated the profile of ${employee.full_name}`,
    });

    return this.empRepo.getProfile(id);
  }

  async markResigned(id: number, resignedAt: string, userId: number, actorName: string) {
    const employee = await this.empRepo.findRowById(id);
    if (!employee) throw new Error('Employee not found');
    if (!isValidDateString(resignedAt)) throw new Error('Resignation date must be YYYY-MM-DD');
    if (employee.work_status === 'RESIGN') throw new Error('This employee is already marked as resigned');

    await this.empRepo.markResigned(id, resignedAt, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      actorName,
      employeeId: id,
      entityType: 'employee',
      entityId: id,
      action: 'RESIGNED',
      summary: `${actorName} marked ${employee.full_name} as resigned on ${resignedAt}`,
    });

    return this.empRepo.getProfile(id);
  }
}
