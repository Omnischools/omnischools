import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CONFIG_WRITE_ROLES, SICKBAY_ROLES } from "@/lib/access";
import {
  getClinicalStaff,
  getHealthPrefects,
  getMatronCandidates,
  getScheduleSlots,
  getSickbayConfig,
} from "@/lib/sickbay/config";
import { SICKBAY_POLICY_ANCHORS, formatDayType, splitBold } from "@/lib/sickbay/defaults";
import { SickbaySetupConsole, type StaffRow } from "@/components/sickbay/setup-console";

export const dynamic = "force-dynamic";

/**
 * `/senior/sickbay/setup` — the sickbay F0 spine (SHS module 4.4 / INCR-21): §1 mode & staff, §2
 * capacity & hours, §5 the two policy anchors. §3 (standing orders / drug stock, INCR-24) and §4
 * (referral hospitals, INCR-25) are ABSENT ENTIRELY — no shell, no badge, no anchor target.
 *
 * READ gate SICKBAY_ROLES (ADMIN / HEADMASTER / MATRON); WRITE gate SICKBAY_CONFIG_WRITE_ROLES
 * (ADMIN / HEADMASTER). The MATRON reads her own staff list, bed inventory and working hours and
 * changes none of them — every server action re-checks the write gate, so a direct POST is refused
 * too (AC E2/E3). The sidebar footer renders the ACTING user; no name is hardcoded anywhere here.
 */
export default async function SickbaySetupPage() {
  const { school, user } = await requireSchoolRole(SICKBAY_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const canWrite = hasAnyRole(roles, SICKBAY_CONFIG_WRITE_ROLES);

  const config = await getSickbayConfig(school.id);
  const [slots, prefects, matronCandidates, staff] = await Promise.all([
    getScheduleSlots(school.id),
    getHealthPrefects(school.id),
    canWrite ? getMatronCandidates(school.id) : Promise.resolve([]),
    getClinicalStaff(school.id, config),
  ]);

  // The doctor's working pattern is DERIVED from his DOCTOR_VISIT slot (days + window) — the same
  // fact the hours table prints, never a second stored copy.
  const doctorSlot = slots.find((s) => s.kind === "DOCTOR_VISIT" && s.active);
  const doctorSchedule = doctorSlot
    ? `${formatDayType(doctorSlot)} ${doctorSlot.startsAt}–${doctorSlot.endsAt}`
    : null;

  // Role lines are composed HERE and handed down as plain strings — the client component never
  // reaches for a data module. `11 years here` is omitted: no staff start-date field exists, and
  // `created_at` is account creation, not tenure (B10).
  const staffRows: StaffRow[] = staff.map((s) => {
    const parts = [s.designation];
    if (s.nmcLicenceNumber) parts.push(`**N&MC #${s.nmcLicenceNumber}**`);
    if (s.affiliation) parts.push(`**${s.affiliation}**`);
    if (s.post === "VISITING_DOCTOR" && doctorSchedule) parts.push(doctorSchedule);
    return {
      post: s.post,
      name: s.name,
      roleLine: parts.join(" · "),
      pill: s.post === "VISITING_DOCTOR" ? "External" : "Matron",
    };
  });

  return (
    <div className="mx-auto max-w-page pb-16">
      <SickbaySetupConsole
        canWrite={canWrite}
        mode={config.mode}
        bedCounts={config.bedCounts}
        slots={slots}
        staff={staffRows}
        prefects={prefects}
        matronCandidates={matronCandidates}
        staffForm={{
          matronUserId: config.matronUserId,
          assistantMatronUserId: config.assistantMatronUserId,
          visitingDoctorName: config.visitingDoctorName,
          visitingDoctorAffiliation: config.visitingDoctorAffiliation,
        }}
      />

      {/* ═══ §5 · Policy anchors — pure editorial, zero schema, zero controls, every mode ═══ */}
      <section className="px-6 pb-10 md:px-9">
        <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-2">
          {SICKBAY_POLICY_ANCHORS.map((a) => (
            <article
              key={a.eyebrow}
              className="relative overflow-hidden rounded-[14px] bg-[linear-gradient(135deg,var(--navy)_0%,var(--navy-2)_100%)] px-7 py-6"
            >
              {/* The one translucency in scope — an rgba literal, never `bg-gold/8` (which renders
                  nothing on a raw-hex token and still passes `next build`). */}
              <span
                aria-hidden
                className="absolute -right-[30px] -top-[30px] size-[140px] rounded-full bg-[rgba(200,151,91,0.08)]"
              />
              <div className="relative mb-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-gold">
                {a.eyebrow}
              </div>
              <h3 className="relative mb-3.5 font-display text-[24px] font-medium leading-[1.15] tracking-[-0.018em] text-bg">
                {a.title}
                <em className="font-normal italic text-gold">{a.titleEm}</em>
              </h3>
              <p className="relative text-[13px] leading-[1.65] text-gold-soft">
                {splitBold(a.body).map((part, i) =>
                  i % 2 === 1 ? (
                    <b key={i} className="font-semibold text-bg">
                      {part}
                    </b>
                  ) : (
                    <span key={i}>{part}</span>
                  ),
                )}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
