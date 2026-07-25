import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { getDormCardForPrint } from "@/lib/sickbay/chronic-reads";
import {
  DORM_CARD_FOOT,
  DORM_CARD_LABEL,
  DORM_CARD_SUB,
  conditionLabel,
} from "@/lib/sickbay/chronic-copy";
import { splitBold } from "@/lib/sickbay/defaults";
import { PrintButton } from "@/components/gradebook/print-button";

export const dynamic = "force-dynamic";

/**
 * `/senior/sickbay/chronic-register/[studentId]/[entryId]/dorm-print` — R136 `Print dorm copy`. A
 * print-stylesheet route (NOT a PDF) rendering the 8 dorm-card rows = the PARTIAL projection. Loading
 * it is INTENT-TO-PRINT: `getDormCardForPrint` writes ONE `audit_log` `exported` row (no web app can
 * observe a physical print). Printable iff the reader's winning scope ≥ PARTIAL AND the plan is not
 * mental-health — ABSENT for a MENTAL_HEALTH plan (C13) and for a DIRECTIVE reader; both `notFound()`.
 */
export default async function DormPrintPage({
  params,
}: {
  params: Promise<{ studentId: string; entryId: string }>;
}) {
  const { studentId, entryId } = await params;
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const { id: userId } = await resolveActor(school.id);

  const now = new Date();
  const view = await getDormCardForPrint(school.id, studentId, entryId, { userId, roles }, now);
  if (!view) notFound(); // no access, a DIRECTIVE reader, or a mental-health plan (C13) — indistinguishable

  const { card } = view;

  return (
    <div className="mx-auto max-w-2xl px-6 py-6 print:px-0 print:py-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href={`/senior/sickbay/chronic-register/${studentId}`}
          className="text-[12px] font-semibold text-gold no-underline"
        >
          ‹ Back to the care plan
        </Link>
        <PrintButton />
      </div>

      <div className="relative rounded-xl border-[1.5px] border-dashed border-gold bg-surface p-[22px_26px] print:border-solid print:border-navy">
        <span className="absolute -top-[9px] left-[18px] bg-bg px-[10px] text-[9px] font-bold tracking-[0.18em] text-gold print:bg-surface">
          {DORM_CARD_LABEL}
        </span>
        <div className="font-display text-[18px] font-semibold text-navy">
          {view.studentName}
          {view.houseName ? ` · ${view.houseName} House` : ""}
        </div>
        <div className="mb-4 text-[11px] text-navy-3">
          <Bold text={DORM_CARD_SUB} />
        </div>
        <AcRow label="Condition" value={conditionLabel(card.condition, card.conditionLabel)} />
        <AcRow label="Triggers" value={card.triggers} />
        <AcRow label="Red flags" value={card.redFlags} />
        <AcRow label="Action" value={card.firstAction} />
        <AcRow label="Daily med" value={card.dormMedNote} />
        {view.guardianName && <AcRow label="Parent" value={view.guardianName} />}
        {view.matronName && view.matronPhone && (
          <AcRow label="Matron" value={`${view.matronName} · ${view.matronPhone}`} />
        )}
        <p className="mt-4 border-t border-border pt-3 text-[11px] leading-[1.5] text-navy-3">
          <Bold text={DORM_CARD_FOOT} />
        </p>
      </div>
    </div>
  );
}

function AcRow({ label, value }: { label: string; value: string | null }) {
  if (!value?.trim()) return null;
  return (
    <div className="grid grid-cols-[110px_1fr] gap-[14px] border-b border-border py-[9px] last:border-b-0">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">{label}</div>
      <div className="text-[12px] text-navy-2">{value}</div>
    </div>
  );
}

function Bold({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-semibold text-navy">
            {part}
          </b>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
