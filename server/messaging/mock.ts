import { randomUUID } from 'node:crypto';
import type { MessagingChannel, MessagingProvider, OutboundMessage, SendResult } from './provider';

/**
 * Development and test provider: nothing leaves the machine.
 *
 * Tests inspect `sent` and script outcomes with `queueResult`. In development, `onSent` lets the worker
 * simulate the delivery receipts a real provider would post back, so the Delivered/Read progression can
 * be seen in the UI without an account.
 */
export class MockProvider implements MessagingProvider {
  readonly name = 'mock';
  readonly sent: OutboundMessage[] = [];
  private scripted: SendResult[] = [];
  onSent?: (message: OutboundMessage, providerMessageId: string) => void;

  supports(_channel: MessagingChannel): boolean {
    return true;
  }

  /** The next send returns `result` instead of succeeding. May be queued several times. */
  queueResult(result: SendResult) {
    this.scripted.push(result);
  }

  reset() {
    this.sent.length = 0;
    this.scripted = [];
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const scripted = this.scripted.shift();
    if (scripted) return scripted;
    const providerMessageId = `mock-${randomUUID()}`;
    this.sent.push(message);
    this.onSent?.(message, providerMessageId);
    return { ok: true, providerMessageId };
  }
}
