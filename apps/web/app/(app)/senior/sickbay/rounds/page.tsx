import { redirect } from "next/navigation";
import { requireSchoolRole, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES, SICKBAY_ROLES } from "@/lib/access";
import { getMedicationRounds, getMarFormOptions } from "@/lib/sickbay/med-admin-reads";
import { ClinicalRestricted } from "@/components/sickbay/clinical-restricted";
import { RoundsConsole } from "@/components/sickbay/rounds-console";

// The rounds board is a derived read of the schedule × today's civil day; wall-clock derivations are
// computed server-side at request time and rendered static (the today-board B15 posture).
export const dynamic = "force-dynamic";

/**
 * `/senior/sickbay/rounds` (Q1) — the matron's derived medication-round worklist (SHS module 4.4 /
 * INCR-24b · today §2).
 *
 * 🔴 TWO gates, the split is the point (R177 · owner D2):
 *   • MODULE access is `SICKBAY_ROLES` — ADMIN reaches the route, is NOT 404'd.
 *   • CLINICAL read is enforced INSIDE `getMedicationRounds`, which returns null for a non-clinical
 *     reader (ADMIN / grantee) BEFORE any query — so this page issues no SQL for them and leaks nothing.
 *   • CLINICAL write is `SICKBAY_CLINICAL_WRITE_ROLES` = [MATRON]: a HEADMASTER reads every round and
 *     gets no `Record` control (an affordance filter, never a data filter).
 */
export default async function SickbayRoundsPage() {
  const { school, user } = await requireSchoolRole(SICKBAY_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const { id: userId } = await resolveActor(school.id);

  const now = new Date();
  const rounds = await getMedicationRounds(school.id, { userId, roles }, now);
  if (rounds === null) return <ClinicalRestricted label="Medication rounds" />;

  const canWrite = hasAnyRole(roles, SICKBAY_CLINICAL_WRITE_ROLES);
  const pickers = (canWrite ? await getMarFormOptions(school.id, { userId, roles }) : null) ?? {
    witnesses: [],
    stockItems: [],
    standingOrders: [],
  };

  const totalDue = rounds.reduce((t, r) => t + r.doses.length, 0);
  const totalGiven = rounds.reduce((t, r) => t + r.givenCount, 0);
  const overdue = rounds.filter((r) => r.status === "OVERDUE").length;

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <a href="/senior/sickbay/setup" className="text-gold no-underline">
          Sickbay
        </a>{" "}
        ·{" "}
        <a href="/senior/sickbay/today" className="text-gold no-underline">
          Today
        </a>{" "}
        · Medication rounds
      </div>
      <div className="mb-6">
        <h1 className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
          Medication <em className="font-normal italic text-gold">rounds</em> · today
        </h1>
        <p className="mt-1 text-[13px] text-navy-3">
          {rounds.length} round{rounds.length === 1 ? "" : "s"} · <b className="font-semibold text-navy-2">{totalGiven}</b>{" "}
          of {totalDue} dose{totalDue === 1 ? "" : "s"} given
          {overdue > 0 && (
            <>
              {" · "}
              <b className="font-semibold text-terra">
                {overdue} round{overdue === 1 ? "" : "s"} overdue
              </b>
            </>
          )}
          . Every chronic-condition dose is dispensed by the Matron in person.
        </p>
      </div>

      {rounds.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-border-2 bg-bg p-[14px_18px] text-[12px] text-navy-2">
          No medication rounds configured.{" "}
          <a href="/senior/sickbay/setup" className="font-semibold text-gold no-underline">
            Set them up in Sickbay setup.
          </a>
        </div>
      ) : (
        <RoundsConsole rounds={rounds} canWrite={canWrite} pickers={pickers} />
      )}
    </div>
  );
}
