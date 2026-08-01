import {
  AssetWithAssignment,
  CreateAnnouncementInput,
  CreateAssetInput,
  CreateEventInput,
  CreateExpenseInput,
  CreateTaskInput,
  CreateTicketInput,
  CreateTrainingInput,
  EngagementRepository,
  EnrollmentStatus,
  TrainingEnrollmentResponse,
  UpdateAnnouncementInput,
} from '../repositories/EngagementRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { NotificationService } from './NotificationService';
import {
  AnnouncementResponse,
  AssetStatus,
  CompanyEventResponse,
  ExpenseCategory,
  ExpenseResponse,
  ExpenseStatus,
  Priority,
  TaskResponse,
  TaskStatus,
  TicketCategory,
  TicketResponse,
  TicketStatus,
  TrainingResponse,
  TrainingStatus,
} from '../types/hrms';
import { isValidDateString, round2, todayString } from '../utils/dateUtils';

// ---------------------------------------------------------------------------
// Enum guards
// ---------------------------------------------------------------------------
const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const TASK_STATUSES: TaskStatus[] = ['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
const TICKET_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const TICKET_CATEGORIES: TicketCategory[] = ['HR', 'PAYROLL', 'IT', 'FACILITY', 'OTHER'];
const EXPENSE_STATUSES: ExpenseStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'REIMBURSED'];
const EXPENSE_CATEGORIES: ExpenseCategory[] = ['TRAVEL', 'FOOD', 'TOOLS', 'MEDICAL', 'OTHER'];
const ASSET_STATUSES: AssetStatus[] = ['AVAILABLE', 'ASSIGNED', 'REPAIR', 'RETIRED'];
const ASSET_CATEGORIES = ['TOOL', 'MACHINE', 'DEVICE', 'FURNITURE', 'OTHER'];
const ANNOUNCEMENT_CATEGORIES = ['NEWS', 'POLICY', 'CELEBRATION', 'ALERT'];
const AUDIENCES = ['ALL', 'STAFF', 'MANAGERS'];
const EVENT_TYPES = ['MEETING', 'TRAINING', 'EVENT', 'AUDIT'];
const TRAINING_STATUSES: TrainingStatus[] = ['PLANNED', 'ONGOING', 'COMPLETED', 'CANCELLED'];
const ENROLLMENT_STATUSES: EnrollmentStatus[] = ['ENROLLED', 'ATTENDED', 'COMPLETED', 'DROPPED'];

/** Roles that see helpdesk / expense escalations. */
const HR_ROLES = ['admin', 'hr'];
const APPROVER_ROLES = ['admin', 'hr', 'accountant'];
const STAFF_ROLES = ['admin', 'manager', 'operator', 'accountant', 'hr'];

function assertEnum<T extends string>(value: any, allowed: readonly T[], label: string): T {
  const v = String(value ?? '').trim().toUpperCase();
  if (!allowed.includes(v as T)) throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  return v as T;
}

/** Accepts `YYYY-MM-DD`, `YYYY-MM-DD HH:MM[:SS]` or an ISO string. */
function toDateTimeString(value: unknown, label: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error(`${label} is required`);
  if (isValidDateString(raw)) return `${raw} 00:00:00`;

  const normalised = raw.replace('T', ' ').replace(/Z$/, '').slice(0, 19);
  const match = normalised.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`${label} must be a valid date or date-time`);
  return `${match[1]} ${match[2]}:${match[3]}:${match[4] ?? '00'}`;
}

export class EngagementService {
  private repo = new EngagementRepository();
  private employeeRepo = new EmployeeRepository();
  private activityRepo = new ActivityRepository();
  private notifications = new NotificationService();

  // =========================================================================
  // TASKS
  // =========================================================================
  async listTasks(filters: { employeeId?: number; status?: string; limit?: number }): Promise<TaskResponse[]> {
    const status = filters.status ? assertEnum(filters.status, TASK_STATUSES, 'Task status') : undefined;
    return this.repo.listTasks({ employeeId: filters.employeeId, status, limit: filters.limit });
  }

  async getTask(id: number): Promise<TaskResponse> {
    const task = await this.repo.findTaskById(id);
    if (!task) throw new Error('Task not found');
    return task;
  }

  async createTask(
    data: { title: string; description?: string | null; employeeId: number; priority?: string; dueDate?: string | null },
    userId: number,
    actorName?: string,
  ): Promise<TaskResponse> {
    const title = String(data.title ?? '').trim();
    if (!title) throw new Error('A task title is required');

    const employeeId = Number(data.employeeId);
    if (!Number.isFinite(employeeId) || employeeId <= 0) throw new Error('A valid employee is required');

    const employee = await this.employeeRepo.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const priority = data.priority ? assertEnum(data.priority, PRIORITIES, 'Priority') : 'MEDIUM';
    if (data.dueDate && !isValidDateString(String(data.dueDate))) {
      throw new Error('dueDate must be a valid YYYY-MM-DD date');
    }

    const payload: CreateTaskInput = {
      title,
      description: data.description ?? null,
      employeeId,
      priority,
      dueDate: data.dueDate || null,
    };
    const id = await this.repo.createTask(payload, userId);

    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      employeeId,
      entityType: 'task',
      entityId: id,
      action: 'CREATE',
      summary: `Assigned task "${title}" to ${employee.full_name}`,
    });

    await this.notifications
      .notifyEmployee(employeeId, {
        category: 'TASK',
        priority: priority === 'URGENT' ? 'URGENT' : 'NORMAL',
        title: 'New task assigned',
        body: title,
        linkPage: 'tasks',
        linkRefId: id,
      })
      .catch(() => undefined);

    return this.getTask(id);
  }

  async updateTaskStatus(id: number, status: string, userId: number): Promise<TaskResponse> {
    const next = assertEnum(status, TASK_STATUSES, 'Task status');
    const existing = await this.repo.findTaskById(id);
    if (!existing) throw new Error('Task not found');

    await this.repo.updateTaskStatus(id, next, userId);
    return this.getTask(id);
  }

  async countPendingByEmployee(employeeId: number): Promise<number> {
    return this.repo.countPendingByEmployee(employeeId);
  }

  async countPendingForEmployees(employeeIds: number[]): Promise<number> {
    return this.repo.countPendingForEmployees(employeeIds);
  }

  // =========================================================================
  // TICKETS (helpdesk)
  // =========================================================================
  async listTickets(filters: { employeeId?: number; status?: string; limit?: number }): Promise<TicketResponse[]> {
    const status = filters.status ? assertEnum(filters.status, TICKET_STATUSES, 'Ticket status') : undefined;
    return this.repo.listTickets({ employeeId: filters.employeeId, status, limit: filters.limit });
  }

  async getTicket(id: number): Promise<TicketResponse> {
    const ticket = await this.repo.findTicketById(id);
    if (!ticket) throw new Error('Ticket not found');
    return ticket;
  }

  async createTicket(
    data: { employeeId: number; category?: string; subject: string; description?: string | null; priority?: string },
    userId: number,
    actorName?: string,
  ): Promise<TicketResponse> {
    const subject = String(data.subject ?? '').trim();
    if (!subject) throw new Error('A ticket subject is required');

    const employeeId = Number(data.employeeId);
    if (!Number.isFinite(employeeId) || employeeId <= 0) throw new Error('A valid employee is required');

    const employee = await this.employeeRepo.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const category = data.category ? assertEnum(data.category, TICKET_CATEGORIES, 'Ticket category') : 'HR';
    const priority = data.priority ? assertEnum(data.priority, PRIORITIES, 'Priority') : 'MEDIUM';

    const payload: CreateTicketInput = {
      employeeId,
      category,
      subject,
      description: data.description ?? null,
      priority,
    };
    const id = await this.repo.createTicket(payload, userId);
    const ticket = await this.getTicket(id);

    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      employeeId,
      entityType: 'ticket',
      entityId: id,
      action: 'CREATE',
      summary: `${employee.full_name} raised ${category} ticket ${ticket.ticketNo}: ${subject}`,
    });

    await this.notifications
      .notifyRoles(HR_ROLES, {
        category: 'HELPDESK',
        priority: priority === 'URGENT' ? 'URGENT' : 'NORMAL',
        title: `New ${category} ticket ${ticket.ticketNo}`,
        body: `${employee.full_name}: ${subject}`,
        linkPage: 'helpdesk',
        linkRefId: id,
      })
      .catch(() => undefined);

    return ticket;
  }

  async updateTicketStatus(
    id: number,
    status: string,
    resolution: string | null | undefined,
    userId: number,
  ): Promise<TicketResponse> {
    const next = assertEnum(status, TICKET_STATUSES, 'Ticket status');
    const existing = await this.repo.findTicketById(id);
    if (!existing) throw new Error('Ticket not found');

    if ((next === 'RESOLVED' || next === 'CLOSED') && !resolution && !existing.resolution) {
      throw new Error('A resolution note is required to resolve or close a ticket');
    }

    await this.repo.updateTicketStatus(id, next, resolution ? String(resolution) : null, userId);

    if (next === 'RESOLVED') {
      await this.notifications
        .notifyEmployee(existing.employeeId, {
          category: 'HELPDESK',
          priority: 'NORMAL',
          title: `Ticket ${existing.ticketNo} resolved`,
          body: resolution ? String(resolution) : existing.subject,
          linkPage: 'helpdesk',
          linkRefId: id,
        })
        .catch(() => undefined);
    }

    return this.getTicket(id);
  }

  async countOpenTickets(): Promise<number> {
    return this.repo.countOpenTickets();
  }

  // =========================================================================
  // EXPENSE CLAIMS
  // =========================================================================
  async listExpenses(filters: { employeeId?: number; status?: string; limit?: number }): Promise<ExpenseResponse[]> {
    const status = filters.status ? assertEnum(filters.status, EXPENSE_STATUSES, 'Expense status') : undefined;
    return this.repo.listExpenses({ employeeId: filters.employeeId, status, limit: filters.limit });
  }

  async getExpense(id: number): Promise<ExpenseResponse> {
    const expense = await this.repo.findExpenseById(id);
    if (!expense) throw new Error('Expense claim not found');
    return expense;
  }

  async createExpense(
    data: {
      employeeId: number;
      category?: string;
      amount: number;
      expenseDate: string;
      description?: string | null;
      receiptPath?: string | null;
    },
    userId: number,
    actorName?: string,
  ): Promise<ExpenseResponse> {
    const employeeId = Number(data.employeeId);
    if (!Number.isFinite(employeeId) || employeeId <= 0) throw new Error('A valid employee is required');

    const employee = await this.employeeRepo.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const amount = round2(Number(data.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Claim amount must be greater than zero');

    const expenseDate = String(data.expenseDate ?? '').trim();
    if (!isValidDateString(expenseDate)) throw new Error('expenseDate must be a valid YYYY-MM-DD date');
    if (expenseDate > todayString()) throw new Error('An expense cannot be dated in the future');

    const category = data.category ? assertEnum(data.category, EXPENSE_CATEGORIES, 'Expense category') : 'OTHER';

    const payload: CreateExpenseInput = {
      employeeId,
      category,
      amount,
      expenseDate,
      description: data.description ?? null,
      receiptPath: data.receiptPath ?? null,
    };
    const id = await this.repo.createExpense(payload, userId);

    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      employeeId,
      entityType: 'expense_claim',
      entityId: id,
      action: 'CREATE',
      summary: `${employee.full_name} claimed ${amount} for ${category}`,
    });

    await this.notifications
      .notifyRoles(APPROVER_ROLES, {
        category: 'EXPENSE',
        priority: 'NORMAL',
        title: 'Expense claim awaiting approval',
        body: `${employee.full_name} claimed ${amount} (${category}).`,
        linkPage: 'expenses',
        linkRefId: id,
      })
      .catch(() => undefined);

    return this.getExpense(id);
  }

  async decideExpense(
    id: number,
    status: 'APPROVED' | 'REJECTED' | 'REIMBURSED',
    userId: number,
    note?: string | null,
  ): Promise<ExpenseResponse> {
    const decision = assertEnum(status, ['APPROVED', 'REJECTED', 'REIMBURSED'] as const, 'Decision');
    const existing = await this.repo.findExpenseById(id);
    if (!existing) throw new Error('Expense claim not found');

    if (decision === 'REIMBURSED' && existing.status !== 'APPROVED') {
      throw new Error('Only an approved claim can be marked as reimbursed');
    }
    if (decision !== 'REIMBURSED' && existing.status !== 'PENDING') {
      throw new Error('This claim has already been decided');
    }
    if (decision === 'REJECTED' && !note) {
      throw new Error('A reason is required when rejecting a claim');
    }

    await this.repo.decideExpense(id, decision, userId, note ? String(note) : null);

    await this.notifications
      .notifyEmployee(existing.employeeId, {
        category: 'EXPENSE',
        priority: 'NORMAL',
        title: `Expense claim ${decision.toLowerCase()}`,
        body: note ? String(note) : `Your ${existing.category} claim of ${existing.amount} was ${decision.toLowerCase()}.`,
        linkPage: 'expenses',
        linkRefId: id,
      })
      .catch(() => undefined);

    return this.getExpense(id);
  }

  async countPendingExpenses(): Promise<number> {
    return this.repo.countPendingExpenses();
  }

  async sumPendingExpenses(): Promise<number> {
    return round2(await this.repo.sumPendingExpenses());
  }

  // =========================================================================
  // ASSETS
  // =========================================================================
  async listAssets(filters: { status?: string; limit?: number }): Promise<AssetWithAssignment[]> {
    const status = filters.status ? assertEnum(filters.status, ASSET_STATUSES, 'Asset status') : undefined;
    return this.repo.listAssets({ status, limit: filters.limit });
  }

  async getAsset(id: number): Promise<AssetWithAssignment> {
    const asset = await this.repo.findAssetById(id);
    if (!asset) throw new Error('Asset not found');
    return asset;
  }

  async createAsset(
    data: {
      assetCode: string;
      name: string;
      category?: string;
      serialNo?: string | null;
      purchaseDate?: string | null;
      purchaseCost?: number | null;
    },
    userId: number,
  ): Promise<AssetWithAssignment> {
    const assetCode = String(data.assetCode ?? '').trim();
    const name = String(data.name ?? '').trim();
    if (!assetCode) throw new Error('An asset code is required');
    if (!name) throw new Error('An asset name is required');

    const clash = await this.repo.findAssetByCode(assetCode);
    if (clash) throw new Error(`Asset code ${assetCode} is already in use`);

    const category = data.category ? assertEnum(data.category, ASSET_CATEGORIES, 'Asset category') : 'TOOL';
    if (data.purchaseDate && !isValidDateString(String(data.purchaseDate))) {
      throw new Error('purchaseDate must be a valid YYYY-MM-DD date');
    }

    const payload: CreateAssetInput = {
      assetCode,
      name,
      category,
      serialNo: data.serialNo ?? null,
      purchaseDate: data.purchaseDate || null,
      purchaseCost:
        data.purchaseCost === undefined || data.purchaseCost === null ? null : round2(Number(data.purchaseCost)),
    };
    const id = await this.repo.createAsset(payload, userId);
    return this.getAsset(id);
  }

  async assignAsset(
    assetId: number,
    employeeId: number,
    assignedOn: string | undefined,
    userId: number,
    actorName?: string,
  ): Promise<{ assignmentId: number; asset: AssetWithAssignment }> {
    const empId = Number(employeeId);
    if (!Number.isFinite(empId) || empId <= 0) throw new Error('A valid employee is required');

    const date = assignedOn ? String(assignedOn) : todayString();
    if (!isValidDateString(date)) throw new Error('assignedOn must be a valid YYYY-MM-DD date');

    const assignmentId = await this.repo.assignAsset(assetId, empId, date, userId);
    const asset = await this.getAsset(assetId);

    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      employeeId: empId,
      entityType: 'asset',
      entityId: assetId,
      action: 'ASSIGN',
      summary: `Issued asset ${asset.assetCode} (${asset.name}) to ${asset.assignedToName ?? 'employee'}`,
    });

    await this.notifications
      .notifyEmployee(empId, {
        category: 'ASSET',
        priority: 'NORMAL',
        title: 'Asset issued to you',
        body: `${asset.assetCode} - ${asset.name}`,
        linkPage: 'assets',
        linkRefId: assetId,
      })
      .catch(() => undefined);

    return { assignmentId, asset };
  }

  async returnAsset(
    assignmentId: number,
    returnedOn: string | undefined,
    userId: number,
    conditionNote?: string | null,
  ): Promise<AssetWithAssignment> {
    const date = returnedOn ? String(returnedOn) : todayString();
    if (!isValidDateString(date)) throw new Error('returnedOn must be a valid YYYY-MM-DD date');

    const assetId = await this.repo.returnAsset(assignmentId, date, userId, conditionNote ?? null);

    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'asset',
      entityId: assetId,
      action: 'RETURN',
      summary: `Asset returned on ${date}`,
    });

    return this.getAsset(assetId);
  }

  async listAssetsByEmployee(employeeId: number): Promise<AssetWithAssignment[]> {
    return this.repo.listAssetsByEmployee(employeeId);
  }

  // =========================================================================
  // ANNOUNCEMENTS
  // =========================================================================
  async listAnnouncements(filters: { activeOnly?: boolean; audience?: string; limit?: number }): Promise<AnnouncementResponse[]> {
    const audience = filters.audience ? assertEnum(filters.audience, AUDIENCES, 'Audience') : undefined;
    return this.repo.listAnnouncements({ activeOnly: filters.activeOnly, audience, limit: filters.limit });
  }

  async getAnnouncement(id: number): Promise<AnnouncementResponse> {
    const announcement = await this.repo.findAnnouncementById(id);
    if (!announcement) throw new Error('Announcement not found');
    return announcement;
  }

  async createAnnouncement(
    data: {
      title: string;
      body: string;
      category?: string;
      pinned?: boolean;
      publishFrom?: string;
      publishTo?: string | null;
      audience?: string;
      notifyAll?: boolean;
    },
    userId: number,
    actorName?: string,
  ): Promise<AnnouncementResponse> {
    const title = String(data.title ?? '').trim();
    const body = String(data.body ?? '').trim();
    if (!title) throw new Error('An announcement title is required');
    if (!body) throw new Error('Announcement body text is required');

    const publishFrom = data.publishFrom ? String(data.publishFrom) : todayString();
    if (!isValidDateString(publishFrom)) throw new Error('publishFrom must be a valid YYYY-MM-DD date');
    if (data.publishTo) {
      if (!isValidDateString(String(data.publishTo))) throw new Error('publishTo must be a valid YYYY-MM-DD date');
      if (String(data.publishTo) < publishFrom) throw new Error('publishTo cannot be before publishFrom');
    }

    const category = data.category
      ? assertEnum(data.category, ANNOUNCEMENT_CATEGORIES, 'Announcement category')
      : 'NEWS';
    const audience = data.audience ? assertEnum(data.audience, AUDIENCES, 'Audience') : 'ALL';

    const payload: CreateAnnouncementInput = {
      title,
      body,
      category,
      pinned: !!data.pinned,
      publishFrom,
      publishTo: data.publishTo || null,
      audience,
    };
    const id = await this.repo.createAnnouncement(payload, userId);

    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      entityType: 'announcement',
      entityId: id,
      action: 'CREATE',
      summary: `Published announcement "${title}"`,
    });

    if (data.notifyAll) {
      await this.notifications
        .notifyRoles(STAFF_ROLES, {
          category: 'POLICY',
          priority: category === 'ALERT' ? 'HIGH' : 'NORMAL',
          title,
          body: body.slice(0, 500),
          linkPage: 'announcements',
          linkRefId: id,
        })
        .catch(() => undefined);
    }

    return this.getAnnouncement(id);
  }

  async updateAnnouncement(
    id: number,
    data: UpdateAnnouncementInput,
    userId: number,
  ): Promise<AnnouncementResponse> {
    const existing = await this.repo.findAnnouncementById(id);
    if (!existing) throw new Error('Announcement not found');

    if (data.category) assertEnum(data.category, ANNOUNCEMENT_CATEGORIES, 'Announcement category');
    if (data.audience) assertEnum(data.audience, AUDIENCES, 'Audience');
    if (data.publishFrom && !isValidDateString(String(data.publishFrom))) {
      throw new Error('publishFrom must be a valid YYYY-MM-DD date');
    }
    if (data.publishTo && !isValidDateString(String(data.publishTo))) {
      throw new Error('publishTo must be a valid YYYY-MM-DD date');
    }

    await this.repo.updateAnnouncement(id, data, userId);
    return this.getAnnouncement(id);
  }

  async removeAnnouncement(id: number): Promise<void> {
    const existing = await this.repo.findAnnouncementById(id);
    if (!existing) throw new Error('Announcement not found');
    await this.repo.softDeleteAnnouncement(id);
  }

  // =========================================================================
  // COMPANY EVENTS
  // =========================================================================
  async listEvents(from?: string, to?: string): Promise<CompanyEventResponse[]> {
    if (from && !isValidDateString(from)) throw new Error('from must be a valid YYYY-MM-DD date');
    if (to && !isValidDateString(to)) throw new Error('to must be a valid YYYY-MM-DD date');
    return this.repo.listEvents(from, to);
  }

  async createEvent(
    data: {
      title: string;
      eventType?: string;
      startAt: string;
      endAt?: string | null;
      location?: string | null;
      description?: string | null;
    },
    userId: number,
  ): Promise<CompanyEventResponse> {
    const title = String(data.title ?? '').trim();
    if (!title) throw new Error('An event title is required');

    const startAt = toDateTimeString(data.startAt, 'startAt');
    const endAt = data.endAt ? toDateTimeString(data.endAt, 'endAt') : null;
    if (endAt && endAt < startAt) throw new Error('endAt cannot be before startAt');

    const eventType = data.eventType ? assertEnum(data.eventType, EVENT_TYPES, 'Event type') : 'EVENT';

    const payload: CreateEventInput = {
      title,
      eventType,
      startAt,
      endAt,
      location: data.location ?? null,
      description: data.description ?? null,
    };
    const id = await this.repo.createEvent(payload, userId);

    const created = await this.repo.findEventById(id);
    if (!created) throw new Error('Event could not be created');
    return created;
  }

  async removeEvent(id: number): Promise<void> {
    const existing = await this.repo.findEventById(id);
    if (!existing) throw new Error('Event not found');
    await this.repo.softDeleteEvent(id);
  }

  // =========================================================================
  // TRAININGS
  // =========================================================================
  async listTrainings(filters: { status?: string; limit?: number }): Promise<TrainingResponse[]> {
    const status = filters.status ? assertEnum(filters.status, TRAINING_STATUSES, 'Training status') : undefined;
    return this.repo.listTrainings({ status, limit: filters.limit });
  }

  async getTraining(id: number): Promise<TrainingResponse> {
    const training = await this.repo.findTrainingById(id);
    if (!training) throw new Error('Training not found');
    return training;
  }

  async createTraining(
    data: { title: string; description?: string | null; trainer?: string | null; startDate: string; endDate?: string | null },
    userId: number,
  ): Promise<TrainingResponse> {
    const title = String(data.title ?? '').trim();
    if (!title) throw new Error('A training title is required');

    const startDate = String(data.startDate ?? '').trim();
    if (!isValidDateString(startDate)) throw new Error('startDate must be a valid YYYY-MM-DD date');
    if (data.endDate) {
      if (!isValidDateString(String(data.endDate))) throw new Error('endDate must be a valid YYYY-MM-DD date');
      if (String(data.endDate) < startDate) throw new Error('endDate cannot be before startDate');
    }

    const payload: CreateTrainingInput = {
      title,
      description: data.description ?? null,
      trainer: data.trainer ?? null,
      startDate,
      endDate: data.endDate || null,
    };
    const id = await this.repo.createTraining(payload, userId);
    return this.getTraining(id);
  }

  async updateTrainingStatus(id: number, status: string, userId: number): Promise<TrainingResponse> {
    const next = assertEnum(status, TRAINING_STATUSES, 'Training status');
    const existing = await this.repo.findTrainingById(id);
    if (!existing) throw new Error('Training not found');

    await this.repo.updateTrainingStatus(id, next, userId);
    return this.getTraining(id);
  }

  async enroll(
    trainingId: number,
    employeeIds: number[],
    userId: number,
    actorName?: string,
  ): Promise<{ enrolled: number; training: TrainingResponse }> {
    const training = await this.repo.findTrainingById(trainingId);
    if (!training) throw new Error('Training not found');

    const ids = Array.from(
      new Set((employeeIds ?? []).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)),
    );
    if (ids.length === 0) throw new Error('At least one employee is required');

    await this.repo.enroll(trainingId, ids);

    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      entityType: 'training',
      entityId: trainingId,
      action: 'ENROLL',
      summary: `Enrolled ${ids.length} employee(s) in "${training.title}"`,
      meta: { employeeIds: ids },
    });

    for (const employeeId of ids) {
      await this.notifications
        .notifyEmployee(employeeId, {
          category: 'TRAINING',
          priority: 'NORMAL',
          title: 'You have been enrolled in a training',
          body: `${training.title} starts on ${training.startDate}.`,
          linkPage: 'trainings',
          linkRefId: trainingId,
        })
        .catch(() => undefined);
    }

    return { enrolled: ids.length, training: await this.getTraining(trainingId) };
  }

  async setEnrollmentStatus(
    trainingId: number,
    employeeId: number,
    status: string,
    score?: number | null,
  ): Promise<TrainingResponse> {
    const next = assertEnum(status, ENROLLMENT_STATUSES, 'Enrollment status');
    const training = await this.repo.findTrainingById(trainingId);
    if (!training) throw new Error('Training not found');

    const enrolled = await this.repo.listEnrollmentEmployeeIds(trainingId);
    if (!enrolled.includes(Number(employeeId))) {
      throw new Error('This employee is not enrolled in the training');
    }

    let parsedScore: number | null = null;
    if (score !== undefined && score !== null && String(score) !== '') {
      parsedScore = Number(score);
      if (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 100) {
        throw new Error('Score must be between 0 and 100');
      }
      parsedScore = round2(parsedScore);
    }

    await this.repo.setEnrollmentStatus(trainingId, Number(employeeId), next, parsedScore);
    return this.getTraining(trainingId);
  }

  async listEnrollmentsByEmployee(employeeId: number): Promise<TrainingEnrollmentResponse[]> {
    return this.repo.listEnrollmentsByEmployee(employeeId);
  }
}
