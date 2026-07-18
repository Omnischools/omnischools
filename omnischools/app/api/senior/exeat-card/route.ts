import { z } from "zod";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, BOARDING_ROLES, canAccessHouse } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { getExeatCardData, type ExeatCardData } from "@/lib/boarding/exeat-data";
import { renderExeatCardPdf } from "@/lib/pdf/render-exeat-card";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ exeatId: z.string().uuid() });

/**
 * GET /api/senior/exeat-card?exeatId — the authenticated printable exeat card PDF (INCR-9 · F2).
 * Keyed by exeat id ONLY (a uuid — no student name or PII in the URL). Enforced SERVER-SIDE:
 *  - requireSchool + BOARDING_ROLES (STUDENT/PARENT/TEACHER/MATRON denied 403).
 *  - house-scope: a plain HOUSEMASTER prints only cards for the House they master (canAccessHouse);
 *    Dean/Headmaster/Admin any House in-school.
 *  - a successful generation writes one auditLog row (EXEAT_CARD_GENERATED: who / exeat / ref_code
 *    / when) — NO scores, NO parent phone. A denied request writes nothing.
 * Streams application/pdf, `private, no-store`.
 */
export async function GET(req: Request) {
  const { school } = await requireSchool();

  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, BOARDING_ROLES)) {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const parsed = Query.safeParse({ exeatId: url.searchParams.get("exeatId") });
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const { exeatId } = parsed.data;

  type Outcome =
    | { kind: "deny"; status: number; message: string }
    | { kind: "ok"; data: ExeatCardData };

  const outcome: Outcome = await withSchool(school.id, async (tx) => {
    const data = await getExeatCardData(tx, school.id, exeatId);
    if (!data) return { kind: "deny", status: 404, message: "Exeat not found." };
    if (!canAccessHouse(user.roles, user.id, data.houseHmUserId)) {
      return { kind: "deny", status: 403, message: "You can only print cards for your House." };
    }
    return { kind: "ok", data };
  });

  if (outcome.kind === "deny") {
    return new Response(outcome.message, { status: outcome.status });
  }

  const pdf = await renderExeatCardPdf(outcome.data);

  const actor = await resolveActor(school.id);
  await withSchool(school.id, (tx) =>
    recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "EXEAT_CARD_GENERATED",
      entityType: "boarding_exeat",
      entityId: exeatId,
      after: { refCode: outcome.data.refCode, house: outcome.data.houseName },
      reason: "Exeat card PDF generated",
    }),
  );

  const filename = `Exeat-Card-${outcome.data.refCode}.pdf`.replace(/[^A-Za-z0-9._-]+/g, "-");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
