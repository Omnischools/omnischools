import { notFound, redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { isStaff } from "@/lib/access";
import { getMinutesView } from "@/lib/pta/minutes-data";
import { getConveneStaffOptions } from "@/lib/pta/meeting-data";
import { MinutesDraft } from "@/components/pta/minutes-draft";

export const dynamic = "force-dynamic";

/**
 * `/senior/pta/meetings/[meetingId]/minutes` — the post-meeting minutes record (SHS module 4.7 / INCR-53).
 * A SINGLE dual-purpose route: the render diverges by minute `status` + the viewer's office — the Secretary
 * sees the draft editor; a Chair on a CHAIR_REVIEW minute sees the Adopt block; an ADOPTED minute renders
 * read-only for everyone. READ = the shared `isStaff` (inherits the PTA layout gate) + BASIC redirect; every
 * WRITE re-checks the Secretary/Chair identity, the clock gates and the 🔴 R451 immutability fence server-side.
 */
export default async function PtaMinutesPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const { meetingId } = await params;
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");
  if (!isStaff(user.roles)) redirect("/dashboard");

  const [view, ownerOptions] = await Promise.all([
    getMinutesView(school.id, meetingId, { userId: user.id, roles: user.roles }),
    getConveneStaffOptions(school.id),
  ]);
  if (!view) notFound();

  return <MinutesDraft view={view} ownerOptions={ownerOptions} />;
}
