import { EmployeeRepository, CreateEmployeeInput, UpdateProfileInput } from '../repositories/EmployeeRepository';
import { LotRepository } from '../repositories/LotRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { isValidDateString } from '../utils/dateUtils';

const WORKER_TYPES = ['PIECE_RATE', 'DHAR', 'MAXI'];
const GENDERS = ['MALE', 'FEMALE', 'OTHER'];

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
