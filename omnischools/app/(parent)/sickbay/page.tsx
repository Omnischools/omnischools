import { requireParent } from "@/lib/auth/server";
import { loadParentPortal } from "@/lib/parent/parent-portal-data";
import {
  loadParentSickbayStatus,
  type ParentSickbayStatus,
} from "@/lib/parent/parent-sickbay-data";
import {
  loadParentNhisStatus,
  type ParentNhisStatus,
} from "@/lib/parent/parent-nhis-data";
import type { NhisStatus } from "@/lib/sickbay/nhis";
import { relationshipLabel, parentLongDate } from "@/lib/wassce/parent-copy";
import { ParentHeader, ParentNav } from "../parent-chrome";

/**
 * INCR-29 · the parent-facing Sickbay tab (reverses D8 for ONE allow-listed read). Same PARENT session
 * gate as the other (parent) routes; the child is resolved from the SESSION (never a URL id). The body
 * is the fact of care only — location-category + care-start date + reassurance — per Lucy's map. Every
 * clinical element (A8–A19) stays omitted; the reader (parent-sickbay-data) is the column guard.
 */
export const dynamic = "force-dynamic";

export default async function ParentSickbayPage() {
  const { user, school } = await requireParent();
  const data = await loadParentPortal(school.id, user.id);
  const child = data.children[0] ?? null;
  const status = child ? await loadParentSickbayStatus(school.id, user.id, child.studentId) : null;
  const nhis = child ? await loadParentNhisStatus(school.id, user.id, child.studentId) : null;

  const guardianDisplay = data.guardianName ?? user.name ?? "Parent";
  const relation = data.guardianRelationship ? relationshipLabel(data.guardianRelationship) : "Parent";

  return (
    <div className="mx-auto max-w-[980px]">
      <ParentHeader
        schoolName={school.name}
        childName={child?.fullName ?? null}
        guardianDisplay={guardianDisplay}
        relation={relation}
      />
      <ParentNav active="Sickbay" />

      <div className="px-7 pb-9 pt-6">
        {!child ? (
          <NoChild />
        ) : (
          <div className="space-y-5">
            <SickbayBody firstName={child.firstName} status={status!} />
            <NhisSection firstName={child.firstName} nhis={nhis} />
          </div>
        )}
      </div>
    </div>
  );
}

/** No portal-linked child — a linking issue, not a health fact (mirrors the WASSCE tab's empty portal). */
function NoChild() {
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-8 text-center text-[13px] leading-relaxed text-navy-2">
      No student is linked to this portal yet. Please contact the school office.
    </div>
  );
}

/**
 * The ONE allowed body (Lucy Part 2) — a calm navy/gold card, never a terra alarm hero. Referred-out
 * (off-campus) takes display precedence over an on-site admission when both facts are open. No open
 * care → the honest empty state (Part 4 / R233), which is the common case.
 */
function SickbayBody({ firstName, status }: { firstName: string; status: ParentSickbayStatus }) {
  const referred = status.referredOut;
  const onSite = !referred && status.onSiteCareOpen;
  if (!referred && !onSite) return <EmptyCare firstName={firstName} />;

  const dateIso = referred ? status.referredOnDate : status.admittedOnDate;
  const dateVerb = referred ? "Referred on" : "In the sickbay since";
  const dateLabel = dateIso ? parentLongDate(new Date(`${dateIso}T00:00:00Z`)) : null;

  return (
    <section className="rounded-xl border border-border bg-surface px-[26px] py-[22px]">
      <h2 className="font-display text-xl font-medium leading-snug text-navy">
        {referred ? (
          <>
            {firstName} has been <em className="text-gold">referred for further care</em>.
          </>
        ) : (
          <>
            {firstName} is <em className="text-gold">in the school sickbay</em> under the matron&apos;s
            care.
          </>
        )}
      </h2>
      {dateLabel && (
        <p className="mt-2 text-[13px] text-navy-2">
          {dateVerb} <span className="font-mono">{dateLabel}</span>.
        </p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-navy-3">
        The school is caring for {firstName}. The matron will call you with any update.
      </p>
    </section>
  );
}

/** The common state — honest "no current sickbay care" (Lucy Part 4, omit-not-fake; never a false hero). */
function EmptyCare({ firstName }: { firstName: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-6 text-center">
      <div className="font-display text-base font-medium text-navy">
        {firstName} has no current sickbay care.
      </div>
      <div className="mt-1.5 text-[13px] leading-relaxed text-navy-2">
        If {firstName} visits the sickbay, you&apos;ll see the status here and the matron will be in
        touch.
      </div>
    </div>
  );
}

/**
 * INCR-32 · the standing NHIS status panel (D8's NHIS half · Kofi R247/R250–R253). Owner call: STATUS +
 * EXPIRY only — never the membership number, holder, or holder-kind (the reader is the column guard).
 * Renders whenever a child is linked (a standing fact, not a care event): four states from the derived
 * status, plus the honest not-registered empty when no card is on file.
 */
const NHIS_LABEL: Record<NhisStatus, string> = {
  ACTIVE: "Active",
  EXPIRING: "Active · renew soon", // valid THROUGH today — still active, a renewal nudge (R247)
  EXPIRED: "Expired",
  UNKNOWN: "On file · expiry not recorded", // a card exists but no expiry recorded (R251)
};

function NhisSection({ firstName, nhis }: { firstName: string; nhis: ParentNhisStatus | null }) {
  // R250 — no card on file (the R183 singleton returns null). Honest, distinct from UNKNOWN (R251).
  if (!nhis) {
    return (
      <section className="rounded-xl border border-border bg-surface px-[26px] py-[22px]">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-3">
          National Health Insurance
        </h3>
        <p className="mt-2 text-[13px] text-navy-2">
          No NHIS card is on file for {firstName}.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-navy-3">
          The school office can help you register {firstName} with the NHIS.
        </p>
      </section>
    );
  }

  const label = NHIS_LABEL[nhis.status];
  // Expiry shows for the three dated states; UNKNOWN has no valid_to so no date (R252).
  const expiryLabel =
    nhis.status !== "UNKNOWN" && nhis.validTo
      ? parentLongDate(new Date(`${nhis.validTo}T00:00:00Z`))
      : null;
  const expiryVerb = nhis.status === "EXPIRED" ? "Expired on" : "Valid until";

  return (
    <section className="rounded-xl border border-border bg-surface px-[26px] py-[22px]">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-3">
        National Health Insurance
      </h3>
      <p className="mt-2 text-[15px] font-medium text-navy">
        {firstName}&apos;s NHIS card is <em className="not-italic text-gold">{label}</em>.
      </p>
      {expiryLabel && (
        <p className="mt-1.5 text-[13px] text-navy-2">
          {expiryVerb} <span className="font-mono">{expiryLabel}</span>.
        </p>
      )}
    </section>
  );
}
