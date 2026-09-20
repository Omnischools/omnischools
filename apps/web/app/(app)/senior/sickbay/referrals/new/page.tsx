import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES, SICKBAY_ROLES } from "@/lib/access";
import {
  getReferableVisits,
  getHeadmasterOptions,
  getMatronOptions,
} from "@/lib/sickbay/referral-reads";
import { getSickbayHospitals } from "@/lib/sickbay/hospitals-reads";
import { ClinicalRestricted } from "@/components/sickbay/clinical-restricted";
import { ReferralNewForm } from "@/components/sickbay/referral-new-form";

export const dynamic = "force-dynamic";

/**
 * `/senior/sickbay/referrals/new` — W1, log a referral OUT off a REFER-disposition visit. MATRON-only
 * write (R195); a HEADMASTER reads the log but cannot author a referral, so this page refuses them.
 */
export default async function NewReferralPage() {
  const { school, user } = await requireSchoolRole(SICKBAY_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  if (!hasAnyRole(roles, SICKBAY_CLINICAL_WRITE_ROLES)) return <ClinicalRestricted label="New referral" />;

  const [visits, hospitals, headmasters, matrons] = await Promise.all([
    getReferableVisits(school.id),
    getSickbayHospitals(school.id),
    getHeadmasterOptions(school.id),
    getMatronOptions(school.id),
  ]);

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <Link href="/senior/sickbay/referrals" className="text-gold no-underline">
          Referrals
        </Link>{" "}
        · New
      </div>
      <h1 className="mb-1 font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
        Log a <em className="font-normal italic text-gold">referral.</em>
      </h1>
      <p className="mb-6 max-w-[720px] text-[13px] text-navy-3">
        A referral hangs off a referred visit. The NHIS card is snapshotted from the student&rsquo;s
        record at this moment, and the ER handoff freezes once saved.
      </p>

      <ReferralNewForm
        visits={visits.map((v) => ({
          visitId: v.visitId,
          studentName: v.studentName,
          studentCode: v.studentCode,
          formLabel: v.formLabel,
          houseName: v.houseName,
          workingImpression: v.workingImpression,
        }))}
        hospitals={hospitals
          .filter((h) => h.active)
          .map((h) => ({ id: h.id, name: h.name, acceptsNhis: h.acceptsNhis }))}
        headmasters={headmasters}
        matrons={matrons}
      />
    </div>
  );
}
