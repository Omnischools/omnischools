import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import {
  hasAnyRole,
  SICKBAY_CONFIG_WRITE_ROLES,
  SICKBAY_ROLES,
  SICKBAY_STOCK_WRITE_ROLES,
} from "@/lib/access";
import {
  getClinicalStaff,
  getHealthPrefects,
  getMatronCandidates,
  getScheduleSlots,
  getSickbayConfig,
} from "@/lib/sickbay/config";
import {
  getControlledRegister,
  getStandingOrders,
  getStockRegister,
} from "@/lib/sickbay/stock-reads";
import { getSickbayHospitals } from "@/lib/sickbay/hospitals-reads";
import { SICKBAY_POLICY_ANCHORS, formatDayType, splitBold } from "@/lib/sickbay/defaults";
import { SickbaySetupConsole, type StaffRow } from "@/components/sickbay/setup-console";
import { StockConsole } from "@/components/sickbay/stock-console";
import { HospitalsConsole } from "@/components/sickbay/hospitals-console";

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
  // §3 flips the write gate: the MATRON GAINS write, the HEADMASTER LOSES it (R165). READ of §3 stays
  // the page's SICKBAY_ROLES gate (ADMIN / HEADMASTER / MATRON) — §3 is config, not the clinical graph,
  // which is exactly why R162 forbids a student name on it.
  const canWriteStock = hasAnyRole(roles, SICKBAY_STOCK_WRITE_ROLES);

  const config = await getSickbayConfig(school.id);
  const caps = config.capabilities;
  const [slots, prefects, matronCandidates, staff, standingOrders, stock, controlled, hospitals] =
    await Promise.all([
      getScheduleSlots(school.id),
      getHealthPrefects(school.id),
      // MATRON candidates back §1/§2's pointer picker (canWrite) AND §3's controlled-wastage witness
      // dropdown (canWriteStock) — a MATRON has the latter but not the former.
      canWrite || canWriteStock ? getMatronCandidates(school.id) : Promise.resolve([]),
      getClinicalStaff(config),
      getStandingOrders(school.id),
      getStockRegister(school.id),
      getControlledRegister(school.id),
      // §04 referral hospitals (INCR-25a) — mode-independent (R198): read in every mode, including
      // REFERRAL_ONLY where every case routes to one. Config write gate is SICKBAY_CONFIG_WRITE_ROLES.
      getSickbayHospitals(school.id),
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
      {/* The client payload is GATED ON THE DERIVED CAPABILITY, not just the render: a Mode-C school
          cannot render a slot table or a visiting doctor, so its flight payload carries neither.
          The rows themselves are untouched in the database and return intact on a switch back. */}
      <SickbaySetupConsole
        canWrite={canWrite}
        mode={config.mode}
        configured={config.configured}
        capabilities={caps}
        bedCounts={config.bedCounts}
        slots={caps.scheduleSlots ? slots : []}
        staff={staffRows}
        prefects={prefects}
        matronCandidates={matronCandidates}
        staffForm={{
          matronUserId: config.matronUserId,
          assistantMatronUserId: config.assistantMatronUserId,
          ...(caps.visitingDoctor && {
            visitingDoctorName: config.visitingDoctorName,
            visitingDoctorAffiliation: config.visitingDoctorAffiliation,
          }),
        }}
      />

      {/* ═══ §3 · Standing orders / stock / controlled register (INCR-24a) ═══ */}
      <StockConsole
        canWrite={canWriteStock}
        standingOrders={standingOrders}
        stock={stock.items}
        reorderCount={stock.reorderCount}
        controlled={controlled}
        clinicians={matronCandidates}
      />

      {/* ═══ §4 · Referral hospitals (INCR-25a) — config gate [ADMIN, HEADMASTER]; MATRON reads only.
          Mode-independent (R198): renders in every mode, and matters most in REFERRAL_ONLY. ═══ */}
      <HospitalsConsole canWrite={canWrite} hospitals={hospitals} />

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
