import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { VLC_PARAGRAPH_READ_ROLES } from "@/lib/access";
import { canWritePastoralFlag } from "@/lib/vlc/authz";
import { getCharacterParagraph } from "@/lib/vlc/paragraph-data";
import { CharacterParagraphCard } from "@/components/vlc/character-paragraph";

export const dynamic = "force-dynamic";

/**
 * 🔴 INCR-43b — `/senior/vlc/reference/[studentId]` — the slim school-leaver CHARACTER PARAGRAPH route (SHS
 * module 4.5), and the ONE VLC surface the HEADMASTER may reach. It renders ONLY the FM-authored paragraph —
 * NOT the 43a confidential casework (journal / notes / observations / case-file), which stay FM+Dean-only and
 * `notFound()` the HM on the journal page. This route keeps the HM one-table-wide BY CONSTRUCTION: it calls a
 * SEPARATE narrow reader (`getCharacterParagraph`) that projects only the paragraph row.
 *
 * Gate sequence: `requireSchoolRole(VLC_PARAGRAPH_READ_ROLES)` (FM + Dean + HEADMASTER; ADMIN / PG / student /
 * parent redirected) → `getCharacterParagraph` re-checks `canReadPastoralParagraph` (own-class FM identity OR
 * Dean OR HM) AND narrows the HM to FINALISED (locked) paragraphs only; a non-gated viewer (other-class FM) or
 * an HM with no finalised paragraph gets `null` → **`notFound()`** — no "a paragraph exists" existence leak.
 * Past the gate, the Edit + "Lock for year-end" affordances render ONLY for a writer (`canWritePastoralFlag`
 * — own-class FM / Dean, NOT the HM); the server actions re-check regardless.
 */
export default async function VlcReferencePage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const { school, user } = await requireSchoolRole(VLC_PARAGRAPH_READ_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  // The reader IS the gate + the sole content path: null = student not found, a non-gated viewer, OR an HM
  // with no finalised paragraph. Either way the confidential route is `notFound()` (no existence leak).
  const view = await getCharacterParagraph(school.id, { roles: user.roles, userId: user.id }, studentId);
  if (!view) notFound();

  // Read admits the HM; WRITE does not. Only an own-class FM / Dean sees the Edit + Lock affordances; the HM
  // is read-only. The server actions re-check this gate regardless — the action is the real boundary.
  const canWrite = canWritePastoralFlag({
    roles: user.roles,
    userId: user.id,
    classTeacherUserId: view.classTeacherUserId,
  });

  return (
    <div className="pb-24">
      <Link
        href="/senior/vlc/sessions"
        className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3 hover:text-navy"
      >
        ← VLC · Session register
      </Link>

      <div className="mt-4">
        <CharacterParagraphCard
          studentId={view.studentId}
          studentName={view.student.fullName}
          formLabel={view.student.formLabel}
          classLabel={view.student.className}
          paragraph={view.paragraph}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
