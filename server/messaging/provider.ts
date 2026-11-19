import { env } from '../config/env';
import { AfricasTalkingProvider } from './africastalking';
import { MockProvider } from './mock';

/**
 * Sending a message to a patient. The rest of the system only knows this interface, so changing provider
 * (or adding WhatsApp) means adding an adapter, not touching the messaging rules.
 */
export type MessagingChannel = 'SMS' | 'WHATSAPP';

export interface OutboundMessage {
  /** E.164 number. */
  to: string;
  text: string;
  channel: MessagingChannel;
  /** Our own id for this message (the CommsLog id), for correlating at the provider. */
  reference: string;
}

export type SendResult =
  | { ok: true; providerMessageId: string }
  /** `transient`: worth retrying (network, provider outage, no balance). Otherwise retrying cannot help. */
  | { ok: false; transient: boolean; reason: string };

export interface MessagingProvider {
  readonly name: string;
  supports(channel: MessagingChannel): boolean;
  send(message: OutboundMessage): Promise<SendResult>;
}

let provider: MessagingProvider | undefined;

export function getProvider(): MessagingProvider {
  provider ??=
    env.MESSAGING_PROVIDER === 'africastalking'
      ? new AfricasTalkingProvider({ username: env.AT_USERNAME!, apiKey: env.AT_API_KEY!, senderId: env.AT_SENDER_ID, baseUrl: env.AT_BASE_URL })
      : new MockProvider();
  return provider;
}

/** Test hook. */
export function setProvider(p: MessagingProvider | undefined) {
  provider = p;
}
