import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const env = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    name: process.env.DB_NAME || 'diamondmatrix_erp',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  uploadDir: process.env.UPLOAD_DIR || path.resolve(__dirname, '../../../storage/uploads'),
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '5', 10),
  /**
   * SMTP is optional. With no host configured, email notifications are recorded
   * as skipped and the in-app notification is still delivered.
   */
  smtp: {
    enabled: !!process.env.SMTP_HOST,
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || 'DiamondMatrix ERP <no-reply@diamondmatrix.local>',
  },
  company: {
    name: process.env.COMPANY_NAME || 'DiamondMatrix',
    appUrl: process.env.APP_URL || 'http://localhost:5173',
  },
  attendance: {
    /**
     * Signing key for kiosk QR tokens. Falls back to the JWT secret so the
     * feature works out of the box, but a dedicated key means rotating QR
     * codes never forces every session to log out.
     */
    qrSecret: process.env.ATTENDANCE_QR_SECRET || process.env.JWT_SECRET || 'dev-secret',
    qrRotationSeconds: parseInt(process.env.ATTENDANCE_QR_ROTATION_SECONDS || '60', 10),
    /**
     * Face matching provider. Nothing is bundled: with no provider configured,
     * verification reports unavailable instead of returning a pass, because a
     * biometric check that always succeeds is worse than none at all.
     */
    faceProvider: process.env.ATTENDANCE_FACE_PROVIDER || '',
    faceApiUrl: process.env.ATTENDANCE_FACE_API_URL || '',
    faceApiKey: process.env.ATTENDANCE_FACE_API_KEY || '',
    faceMatchThreshold: parseFloat(process.env.ATTENDANCE_FACE_THRESHOLD || '85'),
    /** Default zone for branches that have not set one. */
    defaultTimezone: process.env.ATTENDANCE_DEFAULT_TIMEZONE || 'Asia/Kolkata',
  },
};