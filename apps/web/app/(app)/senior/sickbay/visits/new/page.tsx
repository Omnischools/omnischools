import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES, SICKBAY_ROLES } from "@/lib/access";
import { searchActiveStudents } from "@/lib/sickbay/visit-reads";
import { NewVisitForm } from "@/components/sickbay/new-visit-form";

export const dynamic = "force-dynamic";

/**
 * `/senior/sickbay/visits/new` — the write path's entry at INCR-22a. The live queue that normally
 * seeds a visit is the `today` board (22c), so this small form is how a visit is opened until then.
 *
 * MODULE gate `SICKBAY_ROLES`; the form itself only renders for `SICKBAY_CLINICAL_WRITE_ROLES`
 * (MATRON). Nothing clinical is read here — the picker is intake identity only (name · form · House
 * · code), so there is no payload to trim.
 */
export default async function NewVisitPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { school, user } = await requireSchoolRole(SICKBAY_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const canWrite = hasAnyRole(roles, SICKBAY_CLINICAL_WRITE_ROLES);
  const q = (await searchParams).q ?? "";
  const students = canWrite ? await searchActiveStudents(school.id, q) : [];

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      {/* R84 crumb convention: `Sickbay` is the module root (setup), `Today` is the board this form
          returns the student to — the visit it opens is QUEUED, and the queue is on the board. */}
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <a href="/senior/sickbay/setup" className="text-gold no-underline">
          Sickbay
        </a>{" "}
        ·{" "}
        <a href="/senior/sickbay/today" className="text-gold no-underline">
          Today
        </a>{" "}
        · New visit
      </div>
      <h1 className="mb-1 font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
        New <em className="font-normal italic text-gold">visit.</em>
      </h1>
      <p className="mb-6 max-w-[720px] text-[13px] text-navy-3">
        Record who presented and what they report, in their words. The clock starts now and stops when
        you begin the visit.
      </p>

      {canWrite ? (
        <NewVisitForm students={students} query={q} />
      ) : (
        <div className="max-w-[720px] rounded-[10px] border border-dashed border-border-2 bg-bg p-[18px_20px] text-[13px] leading-[1.65] text-navy-2">
          Only the <b className="font-semibold text-navy">Matron</b> can open a sickbay visit.
        </div>
      )}
    </div>
  );
}
