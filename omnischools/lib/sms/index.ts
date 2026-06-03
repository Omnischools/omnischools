import "server-only";
import { env } from "@/lib/env";
import { normalizeGhanaPhone } from "@/lib/auth";

/**
 * SMS abstraction (BUILD_STACK: Hubtel primary, Africa's Talking fallback).
 * Feature code calls sendSms(); the provider is chosen from env. Until Hubtel
 * credentials exist, the console provider logs messages so flows are testable.
 */
export interface SmsMessage {
  to: string;
  body: string;
}
export interface SmsResult {
  ok: boolean;
  provider: string;
  id?: string;
  error?: string;
}
export interface SmsProvider {
  readonly name: string;
  send(msg: SmsMessage): Promise<SmsResult>;
}

class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  async send({ to, body }: SmsMessage): Promise<SmsResult> {
    const normalized = normalizeGhanaPhone(to);
    console.info(`[sms:console] → ${normalized}: ${body}`);
    return { ok: true, provider: this.name, id: `console-${Date.now()}` };
  }
}

class HubtelSmsProvider implements SmsProvider {
  readonly name = "hubtel";
  async send({ to, body }: SmsMessage): Promise<SmsResult> {
    const normalized = normalizeGhanaPhone(to);
    const auth = Buffer.from(
      `${env.HUBTEL_CLIENT_ID}:${env.HUBTEL_CLIENT_SECRET}`,
    ).toString("base64");
    try {
      const res = await fetch("https://sms.hubtel.com/v1/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          From: env.HUBTEL_SENDER_ID ?? "Omnischools",
          To: normalized,
          Content: body,
        }),
      });
      if (!res.ok) {
        return { ok: false, provider: this.name, error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { messageId?: string };
      return { ok: true, provider: this.name, id: data.messageId };
    } catch (err) {
      return { ok: false, provider: this.name, error: String(err) };
    }
  }
}

export function getSmsProvider(): SmsProvider {
  if (env.HUBTEL_CLIENT_ID && env.HUBTEL_CLIENT_SECRET) {
    return new HubtelSmsProvider();
  }
  return new ConsoleSmsProvider();
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  return getSmsProvider().send({ to, body });
}
