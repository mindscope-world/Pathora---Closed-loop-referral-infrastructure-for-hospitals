import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text only: user-supplied names appear in these messages, and text cannot carry injected markup. */
  text: string;
}

export interface Mailer {
  /** false when no email can actually be sent (callers then show the link to the person who invited). */
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

/** Used when SMTP is not configured. Deliberately does nothing: invitation links are secrets and must not land in logs. */
export class NullMailer implements Mailer {
  readonly configured = false;
  async send(): Promise<void> {}
}

export class SmtpMailer implements Mailer {
  readonly configured = true;
  constructor(private readonly transport: Transporter, private readonly from: string) {}

  async send(m: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: m.to,
      // Header values must be single-line: a newline here would let a user-supplied name inject headers.
      subject: m.subject.replace(/[\r\n]+/g, ' ').trim(),
      text: m.text,
    });
  }
}

let mailer: Mailer | undefined;
export function getMailer(): Mailer {
  mailer ??= env.SMTP_URL ? new SmtpMailer(createTransport(env.SMTP_URL), env.MAIL_FROM) : new NullMailer();
  return mailer;
}
/** Test hook. */
export function setMailer(m: Mailer | undefined) {
  mailer = m;
}

export function inviteEmail(p: { to: string; inviteeName: string; inviterName: string; organization: string; roleLabel: string; url: string; days: number }): MailMessage {
  return {
    to: p.to,
    subject: `${p.inviterName} invited you to join ${p.organization} on Pathora`,
    text: [
      `Hello ${p.inviteeName},`,
      '',
      `${p.inviterName} has invited you to join ${p.organization} on Pathora as ${p.roleLabel}.`,
      '',
      `Accept the invitation and choose your password (the link works once and expires in ${p.days} days):`,
      p.url,
      '',
      'If you were not expecting this invitation, you can safely ignore this email.',
    ].join('\n'),
  };
}

/** Alert email for a notification. Carries only the referral number and facility, never patient details. */
export function notificationEmail(p: { to: string; recipientName: string; title: string; body: string; appUrl: string }): MailMessage {
  return {
    to: p.to,
    subject: `Pathora: ${p.title}`,
    text: [`Hello ${p.recipientName},`, '', p.body, '', `Sign in to review and act: ${p.appUrl}`].join('\n'),
  };
}

/** Tells the team about a walkthrough request. Text only; the values were validated as single-line. */
export function leadEmail(p: { to: string; name: string; organization: string; email: string; pathway: string }): MailMessage {
  return {
    to: p.to,
    subject: `Pathora walkthrough request: ${p.organization}`,
    text: ['New walkthrough request from the website.', '', `Name: ${p.name}`, `Organization: ${p.organization}`, `Email: ${p.email}`, `Pathway: ${p.pathway}`].join('\n'),
  };
}
