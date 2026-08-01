import {
  CandidateFilters,
  CandidateRepository,
  CreateCandidateInput,
  CreateOpeningInput,
  UpdateCandidateInput,
  UpdateOpeningInput,
} from '../repositories/CandidateRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { NotificationService } from './NotificationService';
import { WorkerType } from '../types';
import {
  CandidateResponse,
  CandidateStatus,
  JobOpeningResponse,
  JobOpeningStatus,
} from '../types/hrms';
import { isValidDateString, todayString } from '../utils/dateUtils';

const CANDIDATE_STATUSES: CandidateStatus[] = ['APPLIED', 'INTERVIEW', 'SELECTED', 'JOINED', 'REJECTED'];
const OPENING_STATUSES: JobOpeningStatus[] = ['OPEN', 'ON_HOLD', 'CLOSED'];
const WORKER_TYPES: WorkerType[] = ['PIECE_RATE', 'DHAR', 'MAXI'];

/** Forward-only pipeline; REJECTED sits outside the ladder. */
const PIPELINE: CandidateStatus[] = ['APPLIED', 'INTERVIEW', 'SELECTED', 'JOINED'];

export interface ConvertOverrides {
  empCode: string;
  grade?: string;
  workerType?: WorkerType;
  joinedAt: string;
  monthlySalary?: number | null;
  shiftId?: number | null;
  department?: string | null;
  designation?: string | null;
}

export class CandidateService {
  private repo = new CandidateRepository();
  private employeeRepo = new EmployeeRepository();
  private activityRepo = new ActivityRepository();
  private notifications = new NotificationService();

  // =========================================================================
  // Job openings
  // =========================================================================
  async listOpenings(status?: string): Promise<JobOpeningResponse[]> {
    if (status && !OPENING_STATUSES.includes(status as JobOpeningStatus)) {
      throw new Error(`Status must be one of: ${OPENING_STATUSES.join(', ')}`);
    }
    return this.repo.findOpenings(status as JobOpeningStatus | undefined);
  }

  async createOpening(data: CreateOpeningInput, userId: number): Promise<JobOpeningResponse> {
    const title = String(data.title ?? '').trim();
    if (!title) throw new Error('A job title is required');

    const openedAt = data.openedAt ? String(data.openedAt) : todayString();
    if (!isValidDateString(openedAt)) throw new Error('openedAt must be a valid YYYY-MM-DD date');

    if (data.workerType && !WORKER_TYPES.includes(data.workerType)) {
      throw new Error(`Worker type must be one of: ${WORKER_TYPES.join(', ')}`);
    }
    const openings = data.openings === undefined ? 1 : Number(data.openings);
    if (!Number.isFinite(openings) || openings < 1) {
      throw new Error('Number of openings must be at least 1');
    }

    const id = await this.repo.createOpening({ ...data, title, openedAt, openings }, userId);
    const created = await this.repo.findOpeningById(id);
    if (!created) throw new Error('Job opening could not be created');
    return created;
  }

  async updateOpening(id: number, data: UpdateOpeningInput, userId: number): Promise<JobOpeningResponse> {
    const existing = await this.repo.findOpeningById(id);
    if (!existing) throw new Error('Job opening not found');

    if (data.status && !OPENING_STATUSES.includes(data.status)) {
      throw new Error(`Status must be one of: ${OPENING_STATUSES.join(', ')}`);
    }
    if (data.workerType && !WORKER_TYPES.includes(data.workerType)) {
      throw new Error(`Worker type must be one of: ${WORKER_TYPES.join(', ')}`);
    }
    if (data.openings !== undefined && (!Number.isFinite(Number(data.openings)) || Number(data.openings) < 1)) {
      throw new Error('Number of openings must be at least 1');
    }

    await this.repo.updateOpening(id, data, userId);
    const updated = await this.repo.findOpeningById(id);
    if (!updated) throw new Error('Job opening not found');
    return updated;
  }

  async closeOpening(id: number, userId: number, closedAt?: string): Promise<JobOpeningResponse> {
    const existing = await this.repo.findOpeningById(id);
    if (!existing) throw new Error('Job opening not found');

    const date = closedAt ? String(closedAt) : todayString();
    if (!isValidDateString(date)) throw new Error('closedAt must be a valid YYYY-MM-DD date');

    await this.repo.closeOpening(id, date, userId);
    const updated = await this.repo.findOpeningById(id);
    if (!updated) throw new Error('Job opening not found');
    return updated;
  }

  async countOpenPositions(): Promise<number> {
    return this.repo.countOpen();
  }

  // =========================================================================
  // Candidates
  // =========================================================================
  async list(filters: CandidateFilters): Promise<CandidateResponse[]> {
    if (filters.status && !CANDIDATE_STATUSES.includes(filters.status)) {
      throw new Error(`Status must be one of: ${CANDIDATE_STATUSES.join(', ')}`);
    }
    return this.repo.findAll(filters);
  }

  async getById(id: number): Promise<CandidateResponse> {
    const candidate = await this.repo.findById(id);
    if (!candidate) throw new Error('Candidate not found');
    return candidate;
  }

  async create(data: CreateCandidateInput, userId: number, actorName?: string): Promise<CandidateResponse> {
    const fullName = String(data.fullName ?? '').trim();
    const phone = String(data.phone ?? '').trim();
    const positionGrade = String(data.positionGrade ?? '').trim();

    if (!fullName) throw new Error('Candidate name is required');
    if (!phone) throw new Error('A contact phone number is required');
    if (!positionGrade) throw new Error('A position grade is required');
    if (data.workerType && !WORKER_TYPES.includes(data.workerType)) {
      throw new Error(`Worker type must be one of: ${WORKER_TYPES.join(', ')}`);
    }

    const id = await this.repo.create({ ...data, fullName, phone, positionGrade }, userId);

    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      entityType: 'candidate',
      entityId: id,
      action: 'CREATE',
      summary: `Added candidate ${fullName} for grade ${positionGrade}`,
    });

    return this.getById(id);
  }

  async update(id: number, data: UpdateCandidateInput, userId: number): Promise<CandidateResponse> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error('Candidate not found');
    if (data.workerType && !WORKER_TYPES.includes(data.workerType)) {
      throw new Error(`Worker type must be one of: ${WORKER_TYPES.join(', ')}`);
    }

    await this.repo.update(id, data, userId);
    return this.getById(id);
  }

  /**
   * Moves a candidate along the hiring pipeline. Rejection is always allowed;
   * every other move must be forward. JOINED is reserved for conversion.
   */
  async updateStatus(
    id: number,
    status: CandidateStatus,
    userId: number,
    actorName?: string,
  ): Promise<CandidateResponse> {
    if (!CANDIDATE_STATUSES.includes(status)) {
      throw new Error(`Status must be one of: ${CANDIDATE_STATUSES.join(', ')}`);
    }
    if (status === 'JOINED') {
      throw new Error('Use convert-to-employee to mark a candidate as joined');
    }

    const existing = await this.repo.findRowById(id);
    if (!existing) throw new Error('Candidate not found');
    if (existing.status === 'JOINED') {
      throw new Error('This candidate has already joined and can no longer be changed');
    }

    if (status !== 'REJECTED') {
      const from = PIPELINE.indexOf(existing.status);
      const to = PIPELINE.indexOf(status);
      if (to <= from) throw new Error('Cannot move a candidate backwards in the pipeline');
    }

    await this.repo.updateStatus(id, status, userId);

    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      entityType: 'candidate',
      entityId: id,
      action: 'STATUS',
      summary: `Candidate ${existing.full_name} moved from ${existing.status} to ${status}`,
    });

    return this.getById(id);
  }

  async remove(id: number): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error('Candidate not found');
    await this.repo.softDelete(id);
  }

  async pipelineCounts(): Promise<Record<CandidateStatus, number>> {
    return this.repo.countByStatus();
  }

  /**
   * Turns a SELECTED candidate into an employee record. The employee insert and
   * the candidate update share one transaction so a failure leaves neither.
   */
  async convertToEmployee(
    candidateId: number,
    overrides: ConvertOverrides,
    userId: number,
    actorName?: string,
  ): Promise<{ employeeId: number; empCode: string }> {
    const empCode = String(overrides.empCode ?? '').trim();
    if (!empCode) throw new Error('An employee code is required');

    const joinedAt = String(overrides.joinedAt ?? '').trim();
    if (!isValidDateString(joinedAt)) throw new Error('joinedAt must be a valid YYYY-MM-DD date');

    if (overrides.workerType && !WORKER_TYPES.includes(overrides.workerType)) {
      throw new Error(`Worker type must be one of: ${WORKER_TYPES.join(', ')}`);
    }

    const clash = await this.employeeRepo.findByEmpCode(empCode);
    if (clash) throw new Error(`Employee code ${empCode} is already in use`);

    const result = await this.repo.withTransaction(async (conn) => {
      const candidate = await this.repo.findRowById(candidateId, conn);
      if (!candidate) throw new Error('Candidate not found');
      if (candidate.status !== 'SELECTED') {
        throw new Error('Only candidates in the SELECTED stage can be converted');
      }

      const shortName = candidate.full_name.trim().split(/\s+/)[0] || candidate.full_name;
      const monthlySalary =
        overrides.monthlySalary === undefined || overrides.monthlySalary === null
          ? candidate.expected_salary === null
            ? null
            : Number(candidate.expected_salary)
          : Number(overrides.monthlySalary);

      const employeeId = await this.employeeRepo.create(
        {
          empCode,
          fullName: candidate.full_name,
          shortName,
          grade: overrides.grade ?? candidate.position_grade,
          workerType: overrides.workerType ?? candidate.worker_type,
          joinedAt,
          whatsapp: candidate.phone ?? null,
          department: overrides.department ?? null,
          designation: overrides.designation ?? null,
          monthlySalary,
          shiftId: overrides.shiftId ?? null,
        },
        userId,
        conn,
      );

      await this.repo.markJoined(candidateId, employeeId, conn);

      await this.activityRepo.log(
        {
          actorUserId: userId,
          actorName: actorName ?? null,
          employeeId,
          entityType: 'candidate',
          entityId: candidateId,
          action: 'CONVERT',
          summary: `Converted candidate ${candidate.full_name} to employee ${empCode}`,
          meta: { candidateId, employeeId, empCode },
        },
        conn,
      );

      return { employeeId, empCode, fullName: candidate.full_name };
    });

    await this.notifications
      .notifyRoles(['admin', 'hr'], {
        category: 'RECRUITMENT',
        priority: 'NORMAL',
        title: 'New employee onboarded',
        body: `${result.fullName} joined as ${result.empCode}.`,
        linkPage: 'employees',
        linkRefId: result.employeeId,
      })
      .catch(() => undefined);

    return { employeeId: result.employeeId, empCode: result.empCode };
  }
}
