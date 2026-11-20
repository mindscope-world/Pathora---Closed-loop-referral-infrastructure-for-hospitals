import type { MessagingChannel, MessagingProvider, OutboundMessage, SendResult } from './provider';

/**
 * Africa's Talking SMS adapter (https://developers.africastalking.com/docs/sms/sending).
 *
 * IMPORTANT: written from the provider's documented API and exercised here only against recorded-style
 * responses, never against the live service. Verify against the AT SANDBOX (set AT_BASE_URL) before
 * going live. WhatsApp is not offered through this adapter: only SMS.
 *
 * Nothing sensitive is logged or put in error text: no phone numbers, no message bodies, no API key.
 */
interface Options {
  username: string;
  apiKey: string;
  senderId?: string;
  baseUrl?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Per-recipient status codes from the send response. 100-102 mean the message was accepted. */
const ACCEPTED = new Set([100, 101, 102]);
/** Problems that retrying later can fix (risk hold, no balance, routing, gateway). */
const TRANSIENT_CODES = new Set([401, 405, 407, 500, 501]);
const REASONS: Record<number, string> = {
  401: 'The provider is holding the message for a risk check',
  402: 'The sender ID is not valid',
  403: 'The phone number is not valid',
  404: 'The number cannot receive text messages',
  405: 'The messaging account is out of balance',
  406: 'The number has blocked messages from this sender',
  407: 'The message could not be routed to the network',
  500: 'The provider had an internal error',
  501: 'The provider gateway had an error',
  502: 'The provider rejected the message',
};

export class AfricasTalkingProvider implements MessagingProvider {
  readonly name = 'africastalking';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: Options) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  supports(channel: MessagingChannel): boolean {
    return channel === 'SMS';
  }

  async send(m: OutboundMessage): Promise<SendResult> {
    if (!this.supports(m.channel)) return { ok: false, transient: false, reason: 'This channel is not available through the SMS provider' };

    const body = new URLSearchParams({ username: this.opts.username, to: m.to, message: m.text });
    if (this.opts.senderId) body.set('from', this.opts.senderId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl ?? 'https://api.africastalking.com'}/version1/messaging`, {
        method: 'POST',
        headers: { apiKey: this.opts.apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
    } catch {
      return { ok: false, transient: true, reason: 'The messaging provider could not be reached' }; // timeout or network
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) return { ok: false, transient: false, reason: 'The messaging provider rejected our credentials' };
    if (res.status === 429 || res.status >= 500) return { ok: false, transient: true, reason: 'The messaging provider is busy or unavailable' };
    if (!res.ok) return { ok: false, transient: false, reason: 'The messaging provider rejected the request' };

    let recipient: { statusCode?: number; messageId?: string } | undefined;
    try {
      const json = (await res.json()) as { SMSMessageData?: { Recipients?: Array<{ statusCode?: number; messageId?: string }> } };
      recipient = json.SMSMessageData?.Recipients?.[0];
    } catch {
      return { ok: false, transient: true, reason: 'The messaging provider sent an unreadable response' };
    }
    // No recipient entry means the provider did not accept the message for delivery.
    if (!recipient || typeof recipient.statusCode !== 'number') return { ok: false, transient: true, reason: 'The messaging provider did not confirm the message' };

    if (ACCEPTED.has(recipient.statusCode)) {
      if (!recipient.messageId) return { ok: false, transient: true, reason: 'The messaging provider did not return a message id' };
      return { ok: true, providerMessageId: recipient.messageId };
    }
    return {
      ok: false,
      transient: TRANSIENT_CODES.has(recipient.statusCode),
      reason: REASONS[recipient.statusCode] ?? 'The messaging provider could not deliver the message',
    };
  }
}
