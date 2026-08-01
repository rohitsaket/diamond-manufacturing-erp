import bcrypt from 'bcryptjs';
import { UserRepository } from '../repositories/UserRepository';
import { generateToken } from '../middleware/auth';

export interface AuthUserResponse {
  email: string;
  name: string;
  role: string;
  employeeId: number | null;
  theme: 'light' | 'dark' | 'system';
  mustChangePassword: boolean;
  avatarUrl: string | null;
}

export class AuthService {
  private userRepo = new UserRepository();

  async login(email: string, password: string): Promise<{ token: string; user: AuthUserResponse }> {
    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      throw new Error('Invalid email or password');
    }

    if (!user.is_active) {
      throw new Error('Account is deactivated');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new Error('Invalid email or password');
    }

    await this.userRepo.updateLastLogin(user.id);

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      employeeId: user.employee_id ?? null,
    });

    return { token, user: toAuthUser(user) };
  }

  async getMe(userId: number): Promise<AuthUserResponse | null> {
    const user = await this.userRepo.findById(userId);
    if (!user) return null;
    return toAuthUser(user);
  }
}

function toAuthUser(user: {
  email: string;
  name: string;
  role: string;
  employee_id?: number | null;
  theme?: 'light' | 'dark' | 'system';
  must_change_password?: boolean;
  avatar_url?: string | null;
}): AuthUserResponse {
  return {
    email: user.email,
    name: user.name,
    role: user.role,
    employeeId: user.employee_id ?? null,
    theme: user.theme ?? 'light',
    mustChangePassword: !!user.must_change_password,
    avatarUrl: user.avatar_url ?? null,
  };
}
