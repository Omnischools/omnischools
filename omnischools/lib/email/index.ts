import "server-only";
import { env } from "@/lib/env";

/**
 * Email abstraction (BUILD_STACK: Resend). Console provider until RESEND_API_KEY is set.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  from?: string;
}
export interface EmailResult {
  ok: boolean;
  provider: string;
  id?: string;
  error?: string;
}

const DEFAULT_FROM = "Omnischools <noreply@omnischools.gh>";

class ConsoleEmailProvider {
  readonly name = "console";
  async send({ to, subject }: EmailMessage): Promise<EmailResult> {
    console.info(`[email:console] → ${to}: ${subject}`);
    return { ok: true, provider: this.name, id: `console-${Date.now()}` };
  }
}

class ResendEmailProvider {
  readonly name = "resend";
  async send(msg: EmailMessage): Promise<EmailResult> {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: msg.from ?? DEFAULT_FROM,
          to: msg.to,
          subject: msg.subject,
          html: msg.html,
        }),
      });
      if (!res.ok) return { ok: false, provider: this.name, error: `HTTP ${res.status}` };
      const data = (await res.json()) as { id?: string };
      return { ok: true, provider: this.name, id: data.id };
    } catch (err) {
      return { ok: false, provider: this.name, error: String(err) };
    }
  }
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const provider = env.RESEND_API_KEY
    ? new ResendEmailProvider()
    : new ConsoleEmailProvider();
  return provider.send(msg);
}
