import { NotificationRepository } from '../repositories/NotificationRepository';
import { ActivityRepository, ActivityInput } from '../repositories/ActivityRepository';
import { UserRepository } from '../repositories/UserRepository';
import { EmailService } from './EmailService';
import { CreateNotificationInput, NotificationResponse } from '../types/hrms';

export class NotificationService {
  private repo = new NotificationRepository();
  private activityRepo = new ActivityRepository();
  private userRepo = new UserRepository();

  /**
   * Creates an in-app notification and, when requested and SMTP is configured,
   * fans out an email. Email failures never propagate: the in-app notification
   * is the source of truth and the failure is recorded on the row.
   */
  async notify(input: CreateNotificationInput): Promise<number> {
    const wantsEmail = !!input.email && EmailService.isEnabled();
    const id = await this.repo.create(input, wantsEmail ? 'PENDING' : 'NONE');

    if (wantsEmail) {
      void this.deliverEmail(id, input);
    }
    return id;
  }

  /** Fan a notification out to every user holding one of the given roles. */
  async notifyRoles(roles: string[], input: Omit<CreateNotificationInput, 'userId'>): Promise<number> {
    const users = await this.userRepo.findByRoles(roles);
    let sent = 0;
    for (const user of users) {
      await this.notify({ ...input, userId: user.id });
      sent++;
    }
    return sent;
  }

  /** Notify the self-service account linked to an employee, if one exists. */
  async notifyEmployee(employeeId: number, input: Omit<CreateNotificationInput, 'userId'>): Promise<boolean> {
    const user = await this.userRepo.findByEmployeeId(employeeId);
    if (!user) return false;
    await this.notify({ ...input, userId: user.id });
    return true;
  }

  private async deliverEmail(id: number, input: CreateNotificationInput): Promise<void> {
    try {
      const user = await this.userRepo.findById(input.userId);
      if (!user?.email) {
        await this.repo.markEmailStatus(id, 'FAILED', 'User has no email address');
        return;
      }
      await EmailService.send(user.email, input.title, input.body ?? input.title);
      await this.repo.markEmailStatus(id, 'SENT');
    } catch (err: any) {
      console.error('[email] delivery failed:', err.message);
      await this.repo.markEmailStatus(id, 'FAILED', err.message).catch(() => undefined);
    }
  }

  async list(
    userId: number,
    filters: { unreadOnly?: boolean; archived?: boolean; category?: string; search?: string; limit?: number },
  ): Promise<NotificationResponse[]> {
    return this.repo.findForUser(userId, filters);
  }

  async unreadCount(userId: number): Promise<number> {
    return this.repo.countUnread(userId);
  }

  async markRead(id: number, userId: number): Promise<void> {
    await this.repo.markRead(id, userId);
  }

  async markAllRead(userId: number): Promise<number> {
    return this.repo.markAllRead(userId);
  }

  async archive(id: number, userId: number): Promise<void> {
    await this.repo.archive(id, userId);
  }

  async snooze(id: number, userId: number, until: string): Promise<void> {
    if (!until) throw new Error('A snooze time is required');
    await this.repo.snooze(id, userId, until);
  }

  /** Convenience passthrough so callers need only one dependency. */
  async logActivity(input: ActivityInput): Promise<void> {
    await this.activityRepo.log(input);
  }
}
