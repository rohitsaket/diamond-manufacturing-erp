import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

/**
 * Email delivery. Entirely optional: with no SMTP_HOST configured the service
 * reports itself disabled and callers fall back to in-app notification only.
 */
export class EmailService {
  private static transporter: Transporter | null = null;
  private static initFailed = false;

  static isEnabled(): boolean {
    return env.smtp.enabled && !EmailService.initFailed;
  }

  private static getTransporter(): Transporter | null {
    if (!env.smtp.enabled || EmailService.initFailed) return null;
    if (EmailService.transporter) return EmailService.transporter;

    try {
      EmailService.transporter = nodemailer.createTransport({
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.secure,
        auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
      });
      return EmailService.transporter;
    } catch (err: any) {
      console.error('[email] transport init failed:', err.message);
      EmailService.initFailed = true;
      return null;
    }
  }

  static async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    const transporter = EmailService.getTransporter();
    if (!transporter) throw new Error('SMTP is not configured');
    await transporter.sendMail({
      from: env.smtp.from,
      to,
      subject,
      text,
      html: html ?? EmailService.wrapHtml(subject, text),
    });
  }

  private static wrapHtml(subject: string, text: string): string {
    const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    return `<div style="font-family:Inter,Arial,sans-serif;color:#111827;max-width:560px">
  <h2 style="font-size:16px;margin:0 0 12px">${subject}</h2>
  <p style="font-size:14px;line-height:1.6;color:#374151">${safe}</p>
  <p style="font-size:12px;color:#9CA3AF;margin-top:24px">
    ${env.company.name} ERP &middot; <a href="${env.company.appUrl}" style="color:#2563EB">Open dashboard</a>
  </p>
</div>`;
  }
}
