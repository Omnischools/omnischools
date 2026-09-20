"use server";
import { z } from "zod";
import { db } from "@/lib/db";
import { marketingLeads } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { captureEvent, captureError } from "@/lib/observability";

const FOUNDER_EMAIL = "hello@omnischools.gh";

const LeadSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  role: z.string().max(120).optional().or(z.literal("")),
  organisation: z.string().max(200).optional().or(z.literal("")),
  email: z.string().email("Enter a valid email"),
  phone: z.string().max(40).optional().or(z.literal("")),
  message: z.string().max(2000).optional().or(z.literal("")),
  source: z.string().max(40).default("demo_form"),
});

export type LeadResult = { ok: true } | { ok: false; error: string };

export async function submitLead(input: unknown): Promise<LeadResult> {
  const parsed = LeadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid submission" };
  }
  const lead = parsed.data;
  try {
    await db.insert(marketingLeads).values({
      name: lead.name,
      role: lead.role || null,
      organisation: lead.organisation || null,
      email: lead.email,
      phone: lead.phone || null,
      message: lead.message || null,
      source: lead.source,
    });

    // Notify founder (console stub until Resend is wired).
    await sendEmail({
      to: FOUNDER_EMAIL,
      subject: `New ${lead.source} lead: ${lead.organisation || lead.name}`,
      html: `<p><b>${lead.name}</b> (${lead.role || "—"}) from <b>${lead.organisation || "—"}</b></p>
             <p>Email: ${lead.email} · Phone: ${lead.phone || "—"}</p>
             <p>${lead.message || "(no message)"}</p>`,
    });

    captureEvent("lead_submitted", { source: lead.source });
    return { ok: true };
  } catch (err) {
    captureError(err, { action: "submitLead" });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
