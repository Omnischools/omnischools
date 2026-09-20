import { z } from "zod";
import { sql } from "drizzle-orm";
import { requireParent } from "@/lib/auth/server";
import { withParentScope } from "@/lib/db/rls";
import { getExeatPolicy } from "@/lib/boarding/config";
import { renderExeatCardPdf } from "@/lib/pdf/render-exeat-card";
import type { ExeatCardPdfData } from "@/lib/pdf/exeat-card-document";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 🔴 EXEAT PHASE 3-A · GET /api/parent/exeat-card/[id] — the parent-downloadable exeat CARD PDF for their
 * OWN child. The ONLY parent card path. Keyed by the exeat id (a uuid from the PATH only — no student name
 * or PII in the URL). Enforced SERVER-SIDE by the SECURITY DEFINER `parent_exeat_card` fn (Wells,
 * prod-paste-0099), which is THE AUTHORITY: it returns a row ONLY for an own-child, download-eligible exeat
 * (SPECIAL→SR_HM_SIGNED/DEPARTED; SCHEDULED/FEE_COLLECTION→HM_APPROVED/DEPARTED) and deliberately OMITS the
 * fee snapshot / signer staff name / bunk. Any other id — ineligible, not-own-child, cross-tenant — returns
 * 0 rows → a neutral 404 with NO bytes (never a leak). The card render is entirely server-side; the client
 * holds only the <a href> link.
 */

const Id = z.string().uuid();

const TYPE_LABEL: Record<string, string> = {
  SCHEDULED: "Scheduled",
  SPECIAL: "Special",
  FEE_COLLECTION: "Fee collection",
};

// UTC — the DB session is UTC; a leave date must not drift with the server zone (the parent-portal
// precedent in lib/parent/parent-exeat-data.ts). date-out (departed_at||depart_at) and date-in (return_by).
const CARD_DT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
});
const fmt = (d: Date | null): string => (d ? CARD_DT.format(d) : "—");

/** The fn's RETURNS TABLE row (timestamptz → Date via the pg driver). */
type RawCard = {
  school_name: string;
  school_code: string;
  ref_code: string;
  student_name: string;
  form_label: string | null;
  house_name: string;
  exeat_type: string;
  date_out: Date | null;
  date_in: Date | null;
  academic_year: string;
  status: string;
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, school } = await requireParent();

  // Next 15: route params are a Promise — await before use. A non-uuid id is a neutral 404 (no leak).
  const parsed = Id.safeParse((await ctx.params).id);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const exeatId = parsed.data;

  const row = await withParentScope(school.id, user.id, async (tx) => {
    const rows = (await tx.execute(
      sql`select * from parent_exeat_card(${school.id}::uuid, ${user.id}::uuid, ${exeatId}::uuid)`,
    )) as unknown as RawCard[];
    return rows[0] ?? null;
  });

  // The fn is the authority: 0 rows ⇒ not own-child / ineligible / cross-tenant ⇒ neutral 404, no bytes.
  if (!row) return new Response("Not found", { status: 404 });

  // Dress code + signer LABEL are school-config STRINGS (no staff PII) the app already holds; the fn
  // deliberately omits the fee snapshot and the signer's name, so the parent card passes neither.
  const policy = await getExeatPolicy(school.id);

  const data: ExeatCardPdfData = {
    school: { name: row.school_name, code: row.school_code },
    refCode: row.ref_code,
    studentName: row.student_name,
    formHouseBunk: `${row.form_label ?? "—"} · ${row.house_name}`, // no bunk on the parent card (fn omits it)
    typeLabel: TYPE_LABEL[row.exeat_type] ?? row.exeat_type,
    dateOut: fmt(row.date_out),
    dateIn: fmt(row.date_in),
    dressCode: policy.dressCode,
    signerLabel: policy.cardSigner, // policy label only — signerActor omitted ⇒ no staff name rendered
    houseName: row.house_name,
    academicYear: row.academic_year,
    // feeLine + signerActor deliberately absent → no money, no staff PII on the parent card.
  };

  const pdf = await renderExeatCardPdf(data);
  const filename = `Exeat-Card-${row.ref_code}.pdf`.replace(/[^A-Za-z0-9._-]+/g, "-");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
