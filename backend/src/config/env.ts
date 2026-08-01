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
    name: process.env.DB_NAME || 'harene_diamond_erp',
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
    from: process.env.SMTP_FROM || 'Harene Diamond ERP <no-reply@harene.local>',
  },
  company: {
    name: process.env.COMPANY_NAME || 'Harene Diamond',
    appUrl: process.env.APP_URL || 'http://localhost:5173',
  },
};
