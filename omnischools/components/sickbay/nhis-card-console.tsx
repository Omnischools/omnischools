"use client";
/**
 * NHIS card identity console (SHS module 4.4 / INCR-25a) — the ONE card per student, rendered on the
 * NHIS management surface. Ported from docs/senior/sickbay-referral-surface-map.md §4 (the D3 card
 * identity + the S2 holder-≠-student holder line).
 *
 * Client component: PLAIN SERIALIZABLE props only — the `NhisCardView` type from `@/lib/sickbay/nhis`,
 * never a `*-reads` module. The status pill is DERIVED (`view.status`), never a stored string. Write
 * affordances render only when `canWrite` (SICKBAY_CLINICAL_WRITE_ROLES = [MATRON], R195) — the
 * HEADMASTER reads the card and sees no edit CTA; the server action re-checks the gate anyway.
 *
 * 🚫 There is NO school-wide roll-up here (the forbidden STPSHS `1,108/1,200 · 92.3%` matrix, R182):
 * this surface only ever shows ONE student's card.
 *
 * Token discipline (`no-alpha-token-opacity`): solid tokens / `-bg` tints only, zero slash-opacity.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveNhisCard } from "@/lib/actions/sickbay-nhis";
import type { NhisCardView, NhisStatus } from "@/lib/sickbay/nhis";

interface GuardianOption {
  id: string;
  name: string;
  relationship: string;
}

const FIELD =
  "w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[12px] text-navy outline-none focus:border-gold";

export function NhisCardConsole({
  canWrite,
  student,
  card,
  guardians,
}: {
  canWrite: boolean;
  student: { id: string; name: string; studentCode: string; initials: string; formLabel: string; houseName: string | null };
  card: NhisCardView | null;
  guardians: GuardianOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  function submit(values: NhisValues) {
    setError(null);
    startTransition(async () => {
      const res = await saveNhisCard({ ...values, studentId: student.id });
      if (!res.ok) {
        setError(res.error ?? "Could not save the NHIS card.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-[14px] border border-border bg-surface p-[18px_20px]">
      {/* Patient header */}
      <div className="flex items-center gap-3 border-b border-border pb-3.5">
        <span className="flex size-11 items-center justify-center rounded-full bg-gold font-display text-[15px] font-semibold text-navy">
          {student.initials}
        </span>
        <div className="min-w-0">
          <div className="font-display text-[18px] font-medium tracking-[-0.01em] text-navy">
            {student.name}
          </div>
          <div className="text-[11px] text-navy-3">
            {student.formLabel}
            {student.houseName ? ` · ${student.houseName} House` : ""} · {student.studentCode}
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-terra bg-terra-bg px-4 py-2.5 text-[12px] font-semibold text-terra">
          {error}
        </div>
      )}

      {editing ? (
        <NhisForm
          initial={card}
          guardians={guardians}
          pending={pending}
          onCancel={() => {
            setError(null);
            setEditing(false);
          }}
          onSubmit={submit}
        />
      ) : card ? (
        <div className="mt-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={card.status} />
            <span className="font-mono text-[13px] font-semibold text-navy">{card.cardNumber}</span>
          </div>
          {/* 🔴 S2 — the holder line, rendered faithfully. When the holder is a guardian it reads
              `{card} · {holder} · {student} (minor)`; holder_name is the source of truth. */}
          <div className="mt-2 text-[12px] text-navy-2">{card.holderLine}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-navy-3">
            <div>
              <span className="block text-[9px] font-bold uppercase tracking-[0.12em]">Holder</span>
              {card.holderKind === "GUARDIAN" ? "Guardian (card-holder ≠ student)" : "Student"}
            </div>
            <div>
              <span className="block text-[9px] font-bold uppercase tracking-[0.12em]">Valid</span>
              <span className="font-mono">
                {card.validFrom ?? "—"} → {card.validTo ?? "—"}
              </span>
            </div>
          </div>
          {canWrite && (
            <button
              type="button"
              className="mt-3 text-[11px] font-semibold text-gold"
              onClick={() => setEditing(true)}
            >
              Edit card
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3.5">
          <p className="text-[12px] italic text-navy-3">No NHIS card on file for this student.</p>
          {canWrite && (
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-gold px-3.5 py-2.5 text-[11px] font-semibold text-gold"
              onClick={() => setEditing(true)}
            >
              <span className="flex size-[18px] items-center justify-center rounded-full bg-gold text-[12px] font-bold text-surface">
                +
              </span>
              Record NHIS card
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type NhisValues = {
  cardNumber: string;
  holderName: string | null;
  holderKind: "STUDENT" | "GUARDIAN";
  validFrom: string | null;
  validTo: string | null;
  studentGuardianId: string | null;
};

function NhisForm({
  initial,
  guardians,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: NhisCardView | null;
  guardians: GuardianOption[];
  pending: boolean;
  onSubmit: (v: NhisValues) => void;
  onCancel: () => void;
}) {
  const [cardNumber, setCardNumber] = useState(initial?.cardNumber ?? "");
  const [holderKind, setHolderKind] = useState<"STUDENT" | "GUARDIAN">(initial?.holderKind ?? "STUDENT");
  const [holderName, setHolderName] = useState(initial?.holderName ?? "");
  const [validFrom, setValidFrom] = useState(initial?.validFrom ?? "");
  const [validTo, setValidTo] = useState(initial?.validTo ?? "");
  const [guardianId, setGuardianId] = useState(initial?.studentGuardianId ?? "");

  return (
    <div className="mt-3.5 rounded-lg border border-border bg-bg p-3.5">
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <Field label="NHIS card number (stored exactly as written)">
          <input
            className={`${FIELD} font-mono`}
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value)}
            placeholder="NHIS-9842-1276-5503"
          />
        </Field>
        <Field label="Card holder">
          <select
            className={FIELD}
            value={holderKind}
            onChange={(e) => setHolderKind(e.target.value as "STUDENT" | "GUARDIAN")}
          >
            <option value="STUDENT">The student</option>
            <option value="GUARDIAN">A guardian (household card)</option>
          </select>
        </Field>
        <Field label="Holder name (as printed on the card)">
          <input className={FIELD} value={holderName} onChange={(e) => setHolderName(e.target.value)} />
        </Field>
        {holderKind === "GUARDIAN" && guardians.length > 0 && (
          <Field label="Link to guardian (optional)">
            <select className={FIELD} value={guardianId} onChange={(e) => setGuardianId(e.target.value)}>
              <option value="">Not linked</option>
              {guardians.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {g.relationship}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Valid from">
          <input
            type="date"
            className={`${FIELD} font-mono`}
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
        </Field>
        <Field label="Valid through">
          <input
            type="date"
            className={`${FIELD} font-mono`}
            value={validTo}
            onChange={(e) => setValidTo(e.target.value)}
          />
        </Field>
      </div>
      <p className="mt-2 text-[10px] italic text-navy-3">
        Status (Active / Expiring / Expired) is worked out from the expiry date — it is never entered.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          className="rounded-md border border-gold bg-gold px-3.5 py-[7px] text-[11px] font-bold text-navy disabled:opacity-50"
          onClick={() =>
            onSubmit({
              cardNumber: cardNumber.trim(),
              holderName: holderName.trim() || null,
              holderKind,
              validFrom: validFrom || null,
              validTo: validTo || null,
              studentGuardianId: holderKind === "GUARDIAN" && guardianId ? guardianId : null,
            })
          }
        >
          {pending ? "Saving…" : "Save card"}
        </button>
        <button
          type="button"
          className="rounded-md border border-border-2 bg-surface px-3.5 py-[7px] text-[11px] font-semibold text-navy"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-navy-3">
        {label}
      </span>
      {children}
    </label>
  );
}

function StatusPill({ status }: { status: NhisStatus }) {
  const cls: Record<NhisStatus, string> = {
    ACTIVE: "bg-green-bg text-green",
    EXPIRING: "bg-warn-bg text-warn",
    EXPIRED: "bg-terra-bg text-terra",
    UNKNOWN: "border border-border bg-bg text-navy-3",
  };
  const label: Record<NhisStatus, string> = {
    ACTIVE: "NHIS active",
    EXPIRING: "Expiring",
    EXPIRED: "Expired",
    UNKNOWN: "No expiry on file",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${cls[status]}`}
    >
      {label[status]}
    </span>
  );
}
