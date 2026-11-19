import { createTransport } from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { getMailer, inviteEmail, NullMailer, SmtpMailer } from './mailer';

describe('SmtpMailer', () => {
  const make = () => new SmtpMailer(createTransport({ jsonTransport: true }), 'Pathora <no-reply@test.example>');
  const capture = async (m: Parameters<SmtpMailer['send']>[0]) => {
    const transport = createTransport({ jsonTransport: true });
    const sent: { from: unknown; to: unknown; subject: string; text: string }[] = [];
    const mailer = new SmtpMailer({ ...transport, sendMail: async (msg: never) => void sent.push(msg) } as never, 'Pathora <no-reply@test.example>');
    await mailer.send(m);
    return sent[0];
  };

  it('is configured, and sends through the transport', async () => {
    const mailer = make();
    expect(mailer.configured).toBe(true);
    await expect(mailer.send({ to: 'a@example.org', subject: 'Hi', text: 'Hello' })).resolves.toBeUndefined();
  });

  it('puts the configured sender, recipient and plain-text body on the message', async () => {
    const msg = await capture({ to: 'a@example.org', subject: 'Hi', text: 'Body' });
    expect(msg).toMatchObject({ from: 'Pathora <no-reply@test.example>', to: 'a@example.org', subject: 'Hi', text: 'Body' });
  });

  it('flattens line breaks in the subject so a name cannot inject mail headers', async () => {
    const msg = await capture({ to: 'a@example.org', subject: 'Invite\r\nBcc: attacker@example.org', text: 'x' });
    expect(msg.subject).not.toMatch(/[\r\n]/);
    expect(msg.subject).toBe('Invite Bcc: attacker@example.org');
  });
});

describe('NullMailer and selection', () => {
  it('is not configured and sends nothing (so link secrets never reach logs)', async () => {
    const m = new NullMailer();
    expect(m.configured).toBe(false);
    await expect(m.send()).resolves.toBeUndefined();
  });
  it('defaults to the null mailer when SMTP_URL is not set', () => {
    expect(getMailer().configured).toBe(false);
  });
});

describe('inviteEmail', () => {
  it('names the inviter, organisation and role, and contains the link once', () => {
    const m = inviteEmail({ to: 'x@example.org', inviteeName: 'Ivy', inviterName: 'Mona', organization: 'Nairobi Network', roleLabel: 'Programme Coordinator', url: 'http://localhost:3000/?invite=abc', days: 7 });
    expect(m.to).toBe('x@example.org');
    expect(m.subject).toBe('Mona invited you to join Nairobi Network on Pathora');
    expect(m.text).toContain('Hello Ivy,');
    expect(m.text).toContain('as Programme Coordinator');
    expect(m.text.split('http://localhost:3000/?invite=abc').length - 1).toBe(1);
  });
  it('is plain text: user-supplied names cannot carry markup', () => {
    const m = inviteEmail({ to: 'x@example.org', inviteeName: '<script>alert(1)</script>', inviterName: 'M', organization: 'O', roleLabel: 'R', url: 'u', days: 7 });
    expect(Object.keys(m).sort()).toEqual(['subject', 'text', 'to']);
  });
});
