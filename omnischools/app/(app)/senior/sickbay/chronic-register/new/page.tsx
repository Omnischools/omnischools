import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { searchActiveStudents } from "@/lib/sickbay/visit-reads";
import { NewChronicPlanForm } from "@/components/sickbay/chronic-plan-forms";

export const dynamic = "force-dynamic";

/**
 * `/senior/sickbay/chronic-register/new` — the `+ Add student` authoring surface (Lucy §5.9).
 *
 * 🔴 The route keeps the register's OWN gate (R117): `requireSchool()` (staff-only since PR #176) +
 * `schoolType !== 'BASIC'`, NOT `requireSchoolRole(SICKBAY_ROLES)` — it is NOT widened or re-gated.
 * The form itself renders ONLY for `SICKBAY_CLINICAL_WRITE_ROLES` (MATRON); the student picker is
 * intake identity only (name · form · House · code), so there is no clinical payload to trim. Every
 * write is refused server-side for a non-matron too (defence in depth).
 */
export default async function NewChronicPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const canWrite = hasAnyRole(roles, SICKBAY_CLINICAL_WRITE_ROLES);
  const q = (await searchParams).q ?? "";
  const students = canWrite ? await searchActiveStudents(school.id, q) : [];

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
        · New care plan
      </div>
      <h1 className="mb-1 font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
        New care <em className="font-normal italic text-gold">plan.</em>
      </h1>
      <p className="mb-6 max-w-[720px] text-[13px] text-navy-3">
        One plan per student per condition. The condition sets the pill colour; everything else is in
        your own words.
      </p>

      {canWrite ? (
        <NewChronicPlanForm students={students} query={q} />
      ) : (
        <div className="max-w-[720px] rounded-[10px] border border-dashed border-border-2 bg-bg p-[18px_20px] text-[13px] leading-[1.65] text-navy-2">
          Only the <b className="font-semibold text-navy">Matron</b> can author a chronic care plan.
        </div>
      )}
    </div>
  );
}
