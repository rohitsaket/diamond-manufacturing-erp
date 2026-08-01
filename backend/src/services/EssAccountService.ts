import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { BaseRepository } from '../repositories/BaseRepository';
import { UserRepository } from '../repositories/UserRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { EmployeeProfileResponse } from '../types/hrms';
import { AuthPayload } from '../middleware/auth';

const BCRYPT_ROUNDS = 10;
const TEMP_PASSWORD_LENGTH = 10;
const MIN_PASSWORD_LENGTH = 6;
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export interface ProvisionLoginInput {
  email?: string;
  password?: string;
}

export interface ProvisionLoginResult {
  userId: number;
  email: string;
  /** Only present when the service generated the password, so it can be handed over once. */
  tempPassword?: string;
}

export interface BulkProvisionResult {
  created: { employeeId: number; empCode: string; email: string; tempPassword?: string }[];
  skipped: { employeeId: number; reason: string }[];
}

export interface MyProfileResponse {
  user: {
    id: number;
    email: string;
    name: string;
    role: string;
    phone: string | null;
    avatarUrl: string | null;
    theme: 'light' | 'dark' | 'system';
    mustChangePassword: boolean;
    employeeId: number | null;
    lastLoginAt: string | null;
  };
  employee: EmployeeProfileResponse | null;
}

/**
 * Reads the columns `UserRepository.findById` deliberately omits (password_hash)
 * and looks past the `is_active` filter so a revoked login is not re-provisioned
 * into a duplicate-email error.
 */
class EssUserRepository extends BaseRepository {
  async findAnyLoginByEmployeeId(
    employeeId: number,
  ): Promise<{ id: number; email: string; is_active: number } | null> {
    const rows = await this.query<any[]>(
      `SELECT id, email, is_active FROM users
        WHERE employee_id = ? AND deleted_at IS NULL
        ORDER BY is_active DESC, id ASC LIMIT 1`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  async findPasswordHash(userId: number): Promise<string | null> {
    const rows = await this.query<any[]>(
      'SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [userId],
    );
    return rows[0]?.password_hash ?? null;
  }
}

/** Employee self-service account management: provisioning, revoking and preferences. */
export class EssAccountService {
  private users = new UserRepository();
  private employees = new EmployeeRepository();
  private activity = new ActivityRepository();
  private essUsers = new EssUserRepository();

  // -------------------------------------------------------------------------
  // Provisioning
  // -------------------------------------------------------------------------
  async provisionLogin(
    employeeId: number,
    input: ProvisionLoginInput,
    actorUserId: number,
  ): Promise<ProvisionLoginResult> {
    if (!employeeId || employeeId < 1) throw new Error('A valid employee id is required');

    const employee = await this.employees.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');
    if (employee.work_status !== 'WORKING') {
      throw new Error('Only working employees can be given a login');
    }

    const existing = await this.essUsers.findAnyLoginByEmployeeId(employeeId);
    if (existing) throw new Error('This employee already has a login');

    const email = (input.email ?? '').trim().toLowerCase() ||
      `${String(employee.emp_code).toLowerCase()}@ess.local`;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That email address is not valid');

    const emailOwner = await this.users.findByEmail(email);
    if (emailOwner) throw new Error('That email address is already in use');

    const supplied = (input.password ?? '').trim();
    if (supplied && supplied.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const generated = supplied ? null : generatePassword();
    const password = supplied || (generated as string);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = await this.users.createEmployeeLogin({
      email,
      passwordHash,
      name: employee.full_name,
      employeeId,
      phone: employee.whatsapp ?? null,
    });

    await this.activity.log({
      actorUserId,
      employeeId,
      entityType: 'user',
      entityId: userId,
      action: 'PROVISION_LOGIN',
      summary: `Self-service login created for ${employee.full_name} (${employee.emp_code})`,
      meta: { email },
    });

    return generated ? { userId, email, tempPassword: generated } : { userId, email };
  }

  async bulkProvision(employeeIds: number[], actorUserId: number): Promise<BulkProvisionResult> {
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      throw new Error('At least one employee id is required');
    }

    const result: BulkProvisionResult = { created: [], skipped: [] };
    const seen = new Set<number>();

    for (const raw of employeeIds) {
      const employeeId = Number(raw);
      if (!Number.isInteger(employeeId) || employeeId < 1) {
        result.skipped.push({ employeeId: Number(raw) || 0, reason: 'Invalid employee id' });
        continue;
      }
      if (seen.has(employeeId)) {
        result.skipped.push({ employeeId, reason: 'Duplicate employee id in request' });
        continue;
      }
      seen.add(employeeId);

      try {
        const created = await this.provisionLogin(employeeId, {}, actorUserId);
        const employee = await this.employees.findRowById(employeeId);
        result.created.push({
          employeeId,
          empCode: employee?.emp_code ?? '',
          email: created.email,
          tempPassword: created.tempPassword,
        });
      } catch (err: any) {
        result.skipped.push({ employeeId, reason: err?.message ?? 'Could not create login' });
      }
    }

    return result;
  }

  async revokeLogin(employeeId: number, actorUserId: number): Promise<{ revoked: boolean }> {
    if (!employeeId || employeeId < 1) throw new Error('A valid employee id is required');

    const existing = await this.essUsers.findAnyLoginByEmployeeId(employeeId);
    if (!existing) throw new Error('This employee does not have a login');

    await this.users.deactivateByEmployeeId(employeeId);
    await this.activity.log({
      actorUserId,
      employeeId,
      entityType: 'user',
      entityId: existing.id,
      action: 'REVOKE_LOGIN',
      summary: `Self-service login revoked (${existing.email})`,
    });

    return { revoked: true };
  }

  // -------------------------------------------------------------------------
  // Self-service preferences
  // -------------------------------------------------------------------------
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    if (!currentPassword) throw new Error('Your current password is required');
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const user = await this.users.findById(userId);
    if (!user) throw new Error('Account not found');

    // findById omits password_hash, so re-read the full row by email and fall
    // back to a direct lookup if the email changed underneath us.
    const full = await this.users.findByEmail(user.email);
    const hash = full?.password_hash ?? (await this.essUsers.findPasswordHash(userId));
    if (!hash) throw new Error('Account not found');

    const matches = await bcrypt.compare(currentPassword, hash);
    if (!matches) throw new Error('Current password is incorrect');

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.users.updatePassword(userId, newHash);

    await this.activity.log({
      actorUserId: userId,
      employeeId: user.employee_id ?? null,
      entityType: 'user',
      entityId: userId,
      action: 'CHANGE_PASSWORD',
      summary: `Password changed for ${user.email}`,
    });
  }

  async setTheme(userId: number, theme: string): Promise<{ theme: 'light' | 'dark' | 'system' }> {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') {
      throw new Error("Theme must be one of 'light', 'dark' or 'system'");
    }
    const user = await this.users.findById(userId);
    if (!user) throw new Error('Account not found');

    await this.users.updateTheme(userId, theme);
    return { theme };
  }

  async getMyProfile(user: AuthPayload): Promise<MyProfileResponse> {
    const row = await this.users.findById(user.userId);
    if (!row) throw new Error('Account not found');

    const employeeId = row.employee_id ?? user.employeeId ?? null;
    const employee = employeeId ? await this.employees.getProfile(employeeId) : null;

    return {
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        phone: row.phone ?? null,
        avatarUrl: row.avatar_url ?? null,
        theme: row.theme ?? 'light',
        mustChangePassword: !!row.must_change_password,
        employeeId,
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
      },
      employee,
    };
  }
}

/** Cryptographically random temp password from an unambiguous alphabet. */
function generatePassword(): string {
  const bytes = crypto.randomBytes(TEMP_PASSWORD_LENGTH);
  let out = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    out += PASSWORD_ALPHABET[(bytes[i] as number) % PASSWORD_ALPHABET.length];
  }
  return out;
}
