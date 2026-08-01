import bcrypt from 'bcryptjs';
import { UserRepository } from '../repositories/UserRepository';
import { generateToken } from '../middleware/auth';

export class AuthService {
  private userRepo = new UserRepository();

  async login(email: string, password: string): Promise<{
    token: string;
    user: { email: string; name: string; role: string };
  }> {
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
    });

    return {
      token,
      user: {
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async getMe(userId: number): Promise<{ email: string; name: string; role: string } | null> {
    const user = await this.userRepo.findById(userId);
    if (!user) return null;
    return {
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }
}
