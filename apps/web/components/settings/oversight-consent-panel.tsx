"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONSENT_STATEMENT_VERSION,
  CONSENT_STATEMENT_PARAGRAPHS,
  type ConsentState,
} from "@/lib/oversight-consent";
import { grantOversightConsent, revokeOversightConsent } from "@/lib/actions/oversight-consent";

type Initial = {
  schoolName: string;
  ownership: "PUBLIC" | "PRIVATE" | "MISSION" | "INTERNATIONAL";
  state: ConsentState;
  grantedByName: string | null;
  grantedByRole: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
  statementVersion: string | null;
};

const strong = "font-semibold text-navy";

/** ADMIN → "Admin", DEAN_OF_BOARDING → "Dean Of Boarding" — display only. */
function titleRole(role: string | null): string {
  if (!role) return "";
  return role
    .split("_")
    .map((w) => (w ? w[0] + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/** The canonical statement — copy single-sourced from lib/oversight-consent.ts so it can't drift. */
function StatementPanel({ schoolName }: { schoolName: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      {CONSENT_STATEMENT_PARAGRAPHS.map((para, i) => (
        <p
          key={i}
          className={`text-sm leading-relaxed text-navy-2${i > 0 ? " mt-4" : ""}`}
        >
          {para.map((seg, j) => {
            if (typeof seg === "string") return <span key={j}>{seg}</span>;
            if ("school" in seg)
              return (
                <strong key={j} className={strong}>
                  {schoolName}
                </strong>
              );
            return (
              <strong key={j} className={strong}>
                {seg.bold}
              </strong>
            );
          })}
        </p>
      ))}
      <p className="mt-4 font-mono text-[11px] text-navy-3">
        Statement version {CONSENT_STATEMENT_VERSION}
      </p>
    </div>
  );
}

/** D7 — the honest scope panel, always visible in every state. */
function ScopePanel() {
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h2 className="font-display text-lg font-semibold text-navy">
        What this consent does — and{" "}
        <em className="not-italic text-gold [font-style:italic]">does not</em> — cover.
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 block text-xs font-semibold text-navy-2">This consent covers:</p>
          <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-navy-2">
            <li>
              The individual record of a <strong className={strong}>named</strong> non-teaching staff
              member, or any staff member <strong className={strong}>not on the GES establishment
              register</strong> (e.g. many private/mission-school staff).
            </li>
            <li>
              Access only through Oversight&apos;s <strong className={strong}>gated, audit-logged</strong>{" "}
              path — every view records the accessing officer, the stated reason, and the exact fields
              released.
            </li>
          </ul>
        </div>
        <div>
          <p className="mb-1.5 block text-xs font-semibold text-navy-2">
            This consent does NOT cover — and nothing here changes:
          </p>
          <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-navy-2">
            <li>
              <strong className={strong}>Aggregate / statistical reporting</strong> — statutory,
              always in effect, with or without this consent.
            </li>
            <li>
              <strong className={strong}>Any student record</strong> — students are never individually
              visible to GES.
            </li>
            <li>
              <strong className={strong}>GES-licensed teachers on the establishment register</strong> —
              statutory oversight, independent of this consent.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export function OversightConsentPanel({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false); // grant confirm checkbox
  const [withdrawing, setWithdrawing] = useState(false); // inline "are you sure" open

  const nonPublic = initial.ownership !== "PUBLIC";

  async function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    okText: string,
  ) {
    setBusy(true);
    setMsg(null);
    const res = await action();
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: okText });
      setConfirmed(false);
      setWithdrawing(false);
      router.refresh();
    } else {
      setMsg({ ok: false, text: res.error ?? "Something went wrong." });
    }
  }

  // The grant block (State NONE and REVOKED share it — only the button label differs).
  function GrantBlock({ label }: { label: string }) {
    return (
      <div>
        <StatementPanel schoolName={initial.schoolName} />
        <label className="mt-4 flex items-start gap-2.5 text-sm text-navy-2">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I confirm I am authorised to grant this for{" "}
            <strong className={strong}>{initial.schoolName}</strong>.
          </span>
        </label>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => run(grantOversightConsent, "Consent granted.")}
            disabled={busy || !confirmed}
            className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {busy ? "Granting…" : label}
          </button>
          {msg && <span className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>{msg.text}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* §6 non-public notice — solid tokens, unmissable; shown in ALL states when ownership ≠ PUBLIC. */}
      {nonPublic && (
        <div className="rounded-xl border border-warn bg-warn-bg p-4">
          <p className="text-sm font-semibold text-warn">Recorded, but not yet in effect</p>
          <p className="mt-1 text-sm leading-relaxed text-navy-2">
            This consent is recorded but will not take effect until Omnischools&apos; Data Protection
            Officer confirms the lawful basis for staff of non-public schools under the Data Protection
            Act, 2012 (Act 843). Until then GES sees aggregates only.
          </p>
        </div>
      )}

      {/* §4.2 state block */}
      {initial.state === "NONE" && (
        <div className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-navy">
            Consent <em className="not-italic text-gold [font-style:italic]">not granted</em>.
          </h2>
          <GrantBlock label="Grant consent" />
        </div>
      )}

      {initial.state === "GRANTED" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-green bg-green-bg p-6">
            <p className="font-display text-lg font-semibold text-navy">✓ Consent granted</p>
            <p className="mt-2 text-sm text-navy-2">
              {initial.grantedByName ? (
                <>
                  Granted by <strong className={strong}>{initial.grantedByName}</strong> (
                  {titleRole(initial.grantedByRole)}) on{" "}
                  <span className="font-mono">{initial.grantedAt}</span>.
                </>
              ) : (
                <>
                  Granted by {titleRole(initial.grantedByRole) || "a former user"} on{" "}
                  <span className="font-mono">{initial.grantedAt}</span>.
                </>
              )}
            </p>
            <p className="mt-2 font-mono text-[11px] text-navy-3">
              Statement version {initial.statementVersion ?? CONSENT_STATEMENT_VERSION}
            </p>
          </div>

          <StatementPanel schoolName={initial.schoolName} />

          {/* D5 — one-click immediate withdraw, light inline confirm (not a modal). */}
          {!withdrawing ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setMsg(null);
                  setWithdrawing(true);
                }}
                disabled={busy}
                className="rounded-md bg-terra px-4 py-2 text-sm font-semibold text-bg transition-colors hover:opacity-90 disabled:opacity-60"
              >
                Withdraw consent
              </button>
              {msg && <span className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>{msg.text}</span>}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-navy-2">
                Withdraw now? GES individual access stops immediately.
              </span>
              <button
                onClick={() => run(revokeOversightConsent, "Consent withdrawn.")}
                disabled={busy}
                className="rounded-md bg-terra px-4 py-2 text-sm font-semibold text-bg transition-colors hover:opacity-90 disabled:opacity-60"
              >
                {busy ? "Withdrawing…" : "Withdraw now"}
              </button>
              <button
                onClick={() => setWithdrawing(false)}
                disabled={busy}
                className="text-sm font-semibold text-navy-2 hover:text-navy"
              >
                Cancel
              </button>
              {msg && !msg.ok && <span className="text-sm text-terra">{msg.text}</span>}
            </div>
          )}
        </div>
      )}

      {initial.state === "REVOKED" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-bg p-6">
            <p className="font-display text-lg font-semibold text-navy">Consent withdrawn</p>
            <p className="mt-2 text-sm text-navy-2">
              Withdrawn on <span className="font-mono">{initial.revokedAt}</span>. GES sees aggregates
              only.
            </p>
          </div>
          <GrantBlock label="Grant consent again" />
        </div>
      )}

      <ScopePanel />
    </div>
  );
}
