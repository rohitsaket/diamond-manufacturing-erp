import crypto from 'crypto';
import { env } from '../config/env';
import { AttendanceCredentialRepository } from '../repositories/AttendanceCredentialRepository';
import { QrTokenResponse } from '../types/attendance';

/**
 * Rotating kiosk QR codes.
 *
 * The token is `deviceId.window.hmac`, where the window is a counter derived
 * from the clock. Because the HMAC covers the window, a screenshot of the code
 * stops working once the window passes -- and because the server can recompute
 * it, the kiosk needs no network round trip to display a valid code.
 *
 * Tokens are also persisted so a single-use or capped code can be enforced and
 * so a punch can point at the exact token it was made with.
 */
export class QrTokenService {
  private repo = new AttendanceCredentialRepository();

  private sign(deviceId: number, windowIndex: number): string {
    return crypto
      .createHmac('sha256', env.attendance.qrSecret)
      .update(`${deviceId}:${windowIndex}`)
      .digest('base64url')
      .slice(0, 32);
  }

  private windowIndex(rotationSeconds: number, at: number = Date.now()): number {
    return Math.floor(at / 1000 / Math.max(1, rotationSeconds));
  }

  /** Issue (or re-issue) the token for the current window. */
  async issue(
    deviceId: number,
    options: { geofenceId?: number | null; branchId?: number | null; rotationSeconds?: number; isStatic?: boolean; maxUses?: number | null; userId: number },
  ): Promise<QrTokenResponse> {
    const rotationSeconds = options.isStatic
      ? 0
      : Math.max(15, options.rotationSeconds ?? env.attendance.qrRotationSeconds);

    const windowIndex = options.isStatic ? 0 : this.windowIndex(rotationSeconds);
    const token = `${deviceId}.${windowIndex}.${this.sign(deviceId, windowIndex)}`;

    const expiresAt = options.isStatic
      ? null
      : new Date((windowIndex + 2) * rotationSeconds * 1000);

    const existing = await this.repo.findQrToken(token);
    if (!existing) {
      await this.repo.createQrToken({
        token,
        deviceId,
        geofenceId: options.geofenceId ?? null,
        branchId: options.branchId ?? null,
        isStatic: !!options.isStatic,
        rotationSeconds,
        expiresAt,
        maxUses: options.maxUses ?? null,
        userId: options.userId,
      });
    }

    return {
      token,
      deviceId,
      geofenceId: options.geofenceId ?? null,
      isStatic: !!options.isStatic,
      rotationSeconds,
      issuedAt: new Date().toISOString(),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      expiresInSeconds: expiresAt ? Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000)) : null,
      // What the kiosk renders. Kept small so it scans reliably at distance.
      payload: token,
    };
  }

  /**
   * Validate a scanned token.
   *
   * The current window and the one before it are both accepted: a worker who
   * starts scanning a fraction of a second before the code rotates should not
   * be rejected for it.
   */
  async validate(token: string): Promise<{
    valid: boolean;
    reason: string;
    deviceId: number | null;
    geofenceId: number | null;
    tokenId: number | null;
  }> {
    const fail = (reason: string) => ({ valid: false, reason, deviceId: null, geofenceId: null, tokenId: null });

    const parts = String(token ?? '').split('.');
    if (parts.length !== 3) return fail('QR token is malformed');

    const deviceId = Number(parts[0]);
    const windowIndex = Number(parts[1]);
    const signature = parts[2] as string;
    if (!Number.isFinite(deviceId) || !Number.isFinite(windowIndex)) return fail('QR token is malformed');

    const record = await this.repo.findQrToken(token);
    if (!record) return fail('QR token is not recognised');
    if (record.status !== 'ACTIVE') return fail(`QR token is ${record.status.toLowerCase()}`);
    if (record.maxUses !== null && record.usedCount >= record.maxUses) return fail('QR token has reached its use limit');

    const expected = this.sign(deviceId, windowIndex);
    // Constant-time compare so a mismatched token cannot be probed byte by byte.
    const provided = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (provided.length !== expectedBuf.length || !crypto.timingSafeEqual(provided, expectedBuf)) {
      return fail('QR token signature does not match');
    }

    if (!record.isStatic) {
      const current = this.windowIndex(record.rotationSeconds || env.attendance.qrRotationSeconds);
      if (windowIndex !== current && windowIndex !== current - 1) {
        return fail('QR code has expired, scan the current code');
      }
    }

    return {
      valid: true,
      reason: 'QR token accepted',
      deviceId: record.deviceId ?? deviceId,
      geofenceId: record.geofenceId,
      tokenId: record.id,
    };
  }

  async consume(tokenId: number): Promise<void> {
    await this.repo.consumeQrToken(tokenId);
  }

  async revoke(tokenId: number): Promise<void> {
    await this.repo.revokeQrToken(tokenId);
  }

  async expireOld(): Promise<number> {
    return this.repo.expireOldQrTokens();
  }
}
