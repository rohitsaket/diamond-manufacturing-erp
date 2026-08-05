import { env } from '../config/env';

/**
 * Face verification seam.
 *
 * No face matching engine ships with this application, and none is bundled by
 * default. Rather than returning a fabricated match score, an unconfigured
 * provider reports `available: false` and the punch engine records the punch
 * with the reason attached and, where a policy demands face verification,
 * refuses it. A biometric gate that always passes is worse than no gate,
 * because it reads as a control that is not there.
 *
 * To wire a real provider, set ATTENDANCE_FACE_PROVIDER plus its URL and key,
 * and implement the call inside `verifyRemote`.
 */

export interface FaceVerificationResult {
  available: boolean;
  verified: boolean;
  matchScore: number | null;
  livenessPassed: boolean | null;
  note: string;
}

export interface FaceEnrollmentResult {
  available: boolean;
  enrolled: boolean;
  externalRef: string | null;
  note: string;
}

const NOT_CONFIGURED =
  'No face recognition provider is configured. Set ATTENDANCE_FACE_PROVIDER to enable face verification, anti-spoofing and liveness checks.';

export class FaceRecognitionProvider {
  get isConfigured(): boolean {
    return !!env.attendance.faceProvider && !!env.attendance.faceApiUrl;
  }

  get providerName(): string {
    return env.attendance.faceProvider || 'NONE';
  }

  /** Capability report, so the UI can say what is and is not switched on. */
  status(): { configured: boolean; provider: string; threshold: number; capabilities: Record<string, boolean>; note: string } {
    const configured = this.isConfigured;
    return {
      configured,
      provider: this.providerName,
      threshold: env.attendance.faceMatchThreshold,
      capabilities: {
        enrollment: configured,
        verification: configured,
        livenessDetection: configured,
        antiSpoofing: configured,
      },
      note: configured
        ? `Face verification is handled by ${this.providerName}.`
        : NOT_CONFIGURED,
    };
  }

  async verify(employeeId: number, imageRef: string | null): Promise<FaceVerificationResult> {
    if (!this.isConfigured) {
      return {
        available: false, verified: false, matchScore: null, livenessPassed: null,
        note: NOT_CONFIGURED,
      };
    }
    if (!imageRef) {
      return {
        available: true, verified: false, matchScore: null, livenessPassed: null,
        note: 'No face image was supplied with the punch.',
      };
    }
    return this.verifyRemote(employeeId, imageRef);
  }

  async enroll(_employeeId: number, imageRefs: string[]): Promise<FaceEnrollmentResult> {
    if (!this.isConfigured) {
      return { available: false, enrolled: false, externalRef: null, note: NOT_CONFIGURED };
    }
    if (!imageRefs.length) {
      return { available: true, enrolled: false, externalRef: null, note: 'At least one face image is required to enrol.' };
    }
    throw new Error(
      `Face enrolment for provider "${this.providerName}" is not implemented. Implement FaceRecognitionProvider.enroll for this provider before enabling it.`,
    );
  }

  /**
   * Provider call. Left unimplemented on purpose -- a stub that returned a
   * plausible score would make an unverified punch look verified.
   */
  private async verifyRemote(_employeeId: number, _imageRef: string): Promise<FaceVerificationResult> {
    throw new Error(
      `Face verification for provider "${this.providerName}" is not implemented. Implement FaceRecognitionProvider.verifyRemote for this provider before enabling it.`,
    );
  }
}

export const faceProvider = new FaceRecognitionProvider();
