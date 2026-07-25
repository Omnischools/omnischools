"use client";
/**
 * Referral write affordances (SHS module 4.4 / INCR-25b) — the case-detail action panel (add ward
 * update · advance status · mark returned · add cost line · void) and the compact Mark-returned button
 * used on the §01 active cards. Client component: PLAIN SERIALIZABLE props only, never a `*-reads`
 * module. Rendered only for the MATRON (`canWrite`); every action re-checks the gate server-side.
 *
 * The legal transitions come from the ONE pure source (`LEGAL_TRANSITIONS`), so the buttons and the
 * server guard can never disagree.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addReferralCostLine,
  advanceReferralStatus,
  markReferralReturned,
  recordReferralUpdate,
  voidReferral,
} from "@/lib/actions/sickbay-referral";
import { LEGAL_TRANSITIONS, REFERRAL_STATUS_LABEL, type ReferralStatus } from "@/lib/sickbay/referrals";

const FIELD =
  "w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[12px] text-navy outline-none focus:border-gold";

export function MarkReturnedButton({ referralId }: { referralId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await markReferralReturned({ referralId });
          if (res.ok) router.refresh();
        })
      }
      className="rounded-md border border-navy bg-navy px-[11px] py-[6px] text-[10px] font-bold text-bg disabled:opacity-50"
    >
      {pending ? "…" : "Mark returned"}
    </button>
  );
}

export function ReferralCaseActions({
  referralId,
  status,
  voided,
  voidReason,
}: {
  referralId: string;
  status: ReferralStatus;
  voided: boolean;
  voidReason?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Could not complete that.");
      else router.refresh();
    });
  };

  if (voided) {
    return (
      <div className="rounded-[12px] border border-border bg-bg p-[16px_20px] text-[12px] italic text-navy-3">
        {voidReason ? `Voided — ${voidReason}. ` : "This referral was voided. "}
        It is retained as a record and cannot be changed.
      </div>
    );
  }

  // The legal non-terminal advances (INPATIENT / RETURNING), from the ONE pure source.
  const advances = LEGAL_TRANSITIONS[status].filter((s) => s !== "RETURNED");
  const canReturn = LEGAL_TRANSITIONS[status].includes("RETURNED");

  return (
    <div className="rounded-[12px] border border-border bg-surface p-[16px_20px]">
      <h3 className="mb-3 font-display text-[15px] font-semibold text-navy">
        Actions <span className="text-[11px] font-normal text-navy-3">· {REFERRAL_STATUS_LABEL[status]}</span>
      </h3>
      {error && (
        <div className="mb-3 rounded-lg border border-terra bg-terra-bg px-3 py-2 text-[11px] font-semibold text-terra">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {advances.map((to) => (
          <button
            key={to}
            type="button"
            disabled={pending}
            onClick={() => run(() => advanceReferralStatus({ referralId, toStatus: to }))}
            className="rounded-md border border-border-2 bg-surface px-3 py-[6px] text-[11px] font-semibold text-navy disabled:opacity-50"
          >
            Mark {REFERRAL_STATUS_LABEL[to].toLowerCase()}
          </button>
        ))}
        {canReturn && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => markReferralReturned({ referralId }))}
            className="rounded-md border border-navy bg-navy px-3 py-[6px] text-[11px] font-bold text-bg disabled:opacity-50"
          >
            Mark returned
          </button>
        )}
      </div>

      <AddUpdate referralId={referralId} pending={pending} run={run} />
      <AddCostLine referralId={referralId} pending={pending} run={run} />

      <details className="mt-4">
        <summary className="cursor-pointer text-[11px] font-semibold text-terra">Void this referral</summary>
        <VoidForm referralId={referralId} pending={pending} run={run} />
      </details>
    </div>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>) => void;

function AddUpdate({ referralId, pending, run }: { referralId: string; pending: boolean; run: Run }) {
  const [clinicianName, setClinicianName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [body, setBody] = useState("");
  return (
    <div className="mt-5 border-t border-border pt-4">
      <h4 className="mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">Add hospital update</h4>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <input className={FIELD} value={clinicianName} onChange={(e) => setClinicianName(e.target.value)} placeholder="Author (e.g. Dr Mensah)" />
        <input className={FIELD} value={affiliation} onChange={(e) => setAffiliation(e.target.value)} placeholder="Role / affiliation (ward round)" />
      </div>
      <textarea
        className={`${FIELD} mt-2 min-h-[56px]`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What the hospital reported"
      />
      <button
        type="button"
        disabled={pending || !body.trim()}
        onClick={() =>
          run(async () => {
            const res = await recordReferralUpdate({
              referralId,
              clinicianName: clinicianName || null,
              clinicianAffiliation: affiliation || null,
              body: body.trim(),
            });
            if (res.ok) {
              setClinicianName("");
              setAffiliation("");
              setBody("");
            }
            return res;
          })
        }
        className="mt-2 rounded-md border border-border-2 bg-surface px-3 py-[6px] text-[11px] font-semibold text-navy disabled:opacity-50"
      >
        Add update
      </button>
    </div>
  );
}

function AddCostLine({ referralId, pending, run }: { referralId: string; pending: boolean; run: Run }) {
  const [item, setItem] = useState("");
  const [provider, setProvider] = useState("");
  const [nhisCovered, setNhisCovered] = useState(true);
  const [oop, setOop] = useState("");
  return (
    <div className="mt-5 border-t border-border pt-4">
      <h4 className="mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">Add cost line</h4>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <input className={FIELD} value={item} onChange={(e) => setItem(e.target.value)} placeholder="Item (e.g. ER consultation)" />
        <input className={FIELD} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Provider" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-navy-2">
          <input type="checkbox" checked={nhisCovered} onChange={(e) => setNhisCovered(e.target.checked)} />
          NHIS covered
        </label>
        {!nhisCovered && (
          <input
            className={`${FIELD} max-w-[160px]`}
            value={oop}
            onChange={(e) => setOop(e.target.value)}
            placeholder="Out-of-pocket (GHS)"
            inputMode="decimal"
          />
        )}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(async () => {
            const res = await addReferralCostLine({
              referralId,
              itemLabel: item || null,
              provider: provider || null,
              nhisCovered,
              outOfPocketAmount: nhisCovered || !oop ? null : Number(oop),
            });
            if (res.ok) {
              setItem("");
              setProvider("");
              setOop("");
              setNhisCovered(true);
            }
            return res;
          })
        }
        className="mt-2 rounded-md border border-border-2 bg-surface px-3 py-[6px] text-[11px] font-semibold text-navy disabled:opacity-50"
      >
        Add cost line
      </button>
      <p className="mt-1.5 text-[10px] italic text-navy-3">
        NHIS-covered items don&apos;t touch billing. No invoice is raised from the sickbay.
      </p>
    </div>
  );
}

function VoidForm({ referralId, pending, run }: { referralId: string; pending: boolean; run: Run }) {
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2">
      <input className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for voiding" />
      <button
        type="button"
        disabled={pending || !reason.trim()}
        onClick={() => run(() => voidReferral({ referralId, reason: reason.trim() }))}
        className="mt-2 rounded-md border border-terra bg-terra-bg px-3 py-[6px] text-[11px] font-bold text-terra disabled:opacity-50"
      >
        Void referral
      </button>
    </div>
  );
}
