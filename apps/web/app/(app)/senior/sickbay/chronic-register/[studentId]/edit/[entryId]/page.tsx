import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { withStaffScope } from "@/lib/db/rls";
import { sickbayChronicEntry, sickbayChronicMed } from "@/db/schema";
import { getRoundSchedule } from "@/lib/sickbay/config";
import { roundColumns } from "@/lib/sickbay/chronic-copy";
import {
  EditChronicPlanForm,
  type EditMedRow,
  type PlanFieldValues,
} from "@/components/sickbay/chronic-plan-forms";

export const dynamic = "force-dynamic";

/**
 * `/senior/sickbay/chronic-register/[studentId]/edit/[entryId]` — the `Edit plan` authoring surface
 * (Lucy §5.1/§5.9). Per-ENTRY, because a student may hold two plans (SCD + asthma).
 *
 * 🔴 The route keeps the register's OWN gate (R117): `requireSchool()` + `schoolType !== 'BASIC'`,
 * then MATRON-only. A HEADMASTER who can READ a plan is redirected to the read page (he never
 * authors — R39). The entry is loaded MATRON-scoped and its editable columns + meds (WITH their
 * surrogate ids, which the pinned reader deliberately withholds) are passed as scalars, never a
 * reader row. This surface writes NO read-audit row — the R121 view trail is the detail route only.
 */
export default async function EditChronicPlanPage({
  params,
}: {
  params: Promise<{ studentId: string; entryId: string }>;
}) {
  const { studentId, entryId } = await params;
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const backToPlan = `/senior/sickbay/chronic-register/${studentId}`;
  if (!hasAnyRole(roles, SICKBAY_CLINICAL_WRITE_ROLES)) redirect(backToPlan);

  const { id: userId } = await resolveActor(school.id);
  if (!userId) redirect(backToPlan);

  const loaded = await withStaffScope(school.id, userId, async (tx) => {
    const [entry] = await tx
      .select({
        id: sickbayChronicEntry.id,
        condition: sickbayChronicEntry.condition,
        conditionLabel: sickbayChronicEntry.conditionLabel,
        status: sickbayChronicEntry.status,
        onSiteTreatable: sickbayChronicEntry.onSiteTreatable,
        referralManaged: sickbayChronicEntry.referralManaged,
        conditionDetail: sickbayChronicEntry.conditionDetail,
        baselineStatus: sickbayChronicEntry.baselineStatus,
        careGoals: sickbayChronicEntry.careGoals,
        emergencyProtocol: sickbayChronicEntry.emergencyProtocol,
        dischargeCriteria: sickbayChronicEntry.dischargeCriteria,
        triggers: sickbayChronicEntry.triggers,
        redFlags: sickbayChronicEntry.redFlags,
        firstAction: sickbayChronicEntry.firstAction,
        externalClinicalHome: sickbayChronicEntry.externalClinicalHome,
        externalPastoralHome: sickbayChronicEntry.externalPastoralHome,
        externalCareCadence: sickbayChronicEntry.externalCareCadence,
      })
      .from(sickbayChronicEntry)
      .where(
        and(
          eq(sickbayChronicEntry.schoolId, school.id),
          eq(sickbayChronicEntry.id, entryId),
          eq(sickbayChronicEntry.studentId, studentId),
          eq(sickbayChronicEntry.active, true),
        ),
      )
      .limit(1);
    if (!entry) return null;

    const meds = await tx
      .select({
        id: sickbayChronicMed.id,
        drugName: sickbayChronicMed.drugName,
        doseLabel: sickbayChronicMed.doseLabel,
        isPrn: sickbayChronicMed.isPrn,
        slotId: sickbayChronicMed.slotId,
        note: sickbayChronicMed.note,
      })
      .from(sickbayChronicMed)
      .where(and(eq(sickbayChronicMed.schoolId, school.id), eq(sickbayChronicMed.entryId, entry.id)));
    return { entry, meds };
  });

  // R118 shape — a plan the matron may not edit is indistinguishable from one that does not exist.
  if (!loaded) notFound();

  const rounds = roundColumns(await getRoundSchedule(school.id));
  const { condition, conditionLabel, status, onSiteTreatable, referralManaged, ...rest } = loaded.entry;
  const initial: Partial<PlanFieldValues> = {
    condition,
    conditionLabel: conditionLabel ?? "",
    status,
    onSiteTreatable,
    referralManaged,
    conditionDetail: rest.conditionDetail ?? "",
    baselineStatus: rest.baselineStatus ?? "",
    careGoals: rest.careGoals ?? "",
    emergencyProtocol: rest.emergencyProtocol ?? "",
    dischargeCriteria: rest.dischargeCriteria ?? "",
    triggers: rest.triggers ?? "",
    redFlags: rest.redFlags ?? "",
    firstAction: rest.firstAction ?? "",
    externalClinicalHome: rest.externalClinicalHome ?? "",
    externalPastoralHome: rest.externalPastoralHome ?? "",
    externalCareCadence: rest.externalCareCadence ?? "",
  };
  const meds: EditMedRow[] = loaded.meds;

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <Link href="/senior/sickbay/today" className="text-gold no-underline">
          Sickbay
        </Link>{" "}
        ·{" "}
        <Link href="/senior/sickbay/chronic-register" className="text-gold no-underline">
          Chronic register
        </Link>{" "}
        ·{" "}
        <Link href={backToPlan} className="text-gold no-underline">
          Care plan
        </Link>{" "}
        · Edit
      </div>
      <h1 className="mb-6 font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
        Edit care <em className="font-normal italic text-gold">plan.</em>
      </h1>

      <EditChronicPlanForm
        entryId={loaded.entry.id}
        studentId={studentId}
        initial={initial}
        meds={meds}
        rounds={rounds}
      />
    </div>
  );
}
