"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  fileScForm,
  generateReadinessStatement,
  recordParentAck,
  type ActionResult,
} from "@/lib/actions/wassce-readiness";
import type { ScFormView } from "@/lib/wassce/readiness-view";

/**
 * WASSCE readiness WRITE panel (SHS module 4.3 / INCR-17) — the three gated flows (file SC-form,
 * generate readiness statement, record parent-ack). CLIENT component: it calls the server actions and
 * imports NO db / server loader (repo memory `reports-data-is-server-only`). All authz + tenant scope +
 * audit live in the actions; this only collects input and reflects the result.
 */

const SC_FORM_OPTIONS = ["SC-3", "SC-7", "SC-12"] as const;
const SC_STATUS_OPTIONS = [
  "DRAFT",
  "FILED",
  "ACKNOWLEDGED",
  "APPROVED",
  "SCHEDULED",
  "COMPLETED",
  "REJECTED",
] as const;
const ACK_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: "IN_PERSON", label: "In person" },
  { value: "PHONE_OTP", label: "Phone OTP" },
  { value: "PDF_UPLOAD", label: "PDF upload" },
];

function Msg({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p className={`mt-2 text-[12px] ${result.ok ? "text-green" : "text-terra"}`}>
      {result.ok ? "Saved." : result.error}
    </p>
  );
}

export function WassceReadinessPanel({
  candidateId,
  scForms,
  hasStatement,
  parentAcknowledged,
  canGenerate,
  generateBlockedReason,
}: {
  candidateId: string;
  scForms: ScFormView[];
  hasStatement: boolean;
  parentAcknowledged: boolean;
  canGenerate: boolean;
  generateBlockedReason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // SC-form state
  const [scForm, setScForm] = useState<string>(scForms[0]?.scForm ?? "SC-12");
  const [scStatus, setScStatus] = useState<string>("FILED");
  const [waecRef, setWaecRef] = useState("");
  const [scNotes, setScNotes] = useState("");
  const [scResult, setScResult] = useState<ActionResult | null>(null);

  // ack state
  const [ackMethod, setAckMethod] = useState("IN_PERSON");
  const [ackPhone, setAckPhone] = useState("");
  const [ackConcerns, setAckConcerns] = useState("");
  const [ackResult, setAckResult] = useState<ActionResult | null>(null);

  const [genResult, setGenResult] = useState<ActionResult | null>(null);

  const run = (fn: () => Promise<ActionResult>, set: (r: ActionResult) => void) =>
    startTransition(async () => {
      const r = await fn();
      set(r);
      if (r.ok) router.refresh();
    });

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* generate statement */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-navy-3">
          Readiness statement
        </div>
        <p className="mt-1 text-[12px] text-navy-2">
          {hasStatement
            ? "A current statement exists. Regenerating freezes a fresh snapshot and supersedes it."
            : "Run the projection once and freeze it into a parent-shareable statement."}
        </p>
        <button
          type="button"
          disabled={pending || !canGenerate}
          onClick={() => run(() => generateReadinessStatement({ candidateId }), setGenResult)}
          className="mt-3 rounded-md bg-navy px-4 py-2 text-[12px] font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-50"
          title={!canGenerate && generateBlockedReason ? generateBlockedReason : undefined}
        >
          {hasStatement ? "Regenerate statement" : "Generate statement"}
        </button>
        {!canGenerate && generateBlockedReason ? (
          <p className="mt-2 text-[11px] text-navy-3">{generateBlockedReason}</p>
        ) : null}
        <Msg result={genResult} />
      </div>

      {/* parent-ack */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-navy-3">
          Record parent acknowledgement
        </div>
        {parentAcknowledged ? (
          <p className="mt-1 text-[12px] text-green">Acknowledged. A confirmation SMS was sent.</p>
        ) : !hasStatement ? (
          <p className="mt-1 text-[12px] text-navy-3">Generate a statement first.</p>
        ) : (
          <div className="mt-2 space-y-2">
            <label className="block text-[11px] text-navy-3">
              Signature method
              <select
                value={ackMethod}
                onChange={(e) => setAckMethod(e.target.value)}
                className="mt-1 w-full rounded-md border border-border-2 bg-bg px-2 py-1.5 text-[12px] text-navy"
              >
                {ACK_METHOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <input
              value={ackPhone}
              onChange={(e) => setAckPhone(e.target.value)}
              placeholder="Parent phone (+233…)"
              className="w-full rounded-md border border-border-2 bg-bg px-2 py-1.5 text-[12px] text-navy"
            />
            <textarea
              value={ackConcerns}
              onChange={(e) => setAckConcerns(e.target.value)}
              placeholder="Parent concerns (optional)"
              rows={2}
              className="w-full rounded-md border border-border-2 bg-bg px-2 py-1.5 text-[12px] text-navy"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    recordParentAck({
                      candidateId,
                      method: ackMethod,
                      phone: ackPhone || undefined,
                      concerns: ackConcerns || undefined,
                    }),
                  setAckResult,
                )
              }
              className="rounded-md bg-gold px-4 py-2 text-[12px] font-semibold text-navy disabled:opacity-50"
            >
              Record acknowledgement
            </button>
          </div>
        )}
        <Msg result={ackResult} />
      </div>

      {/* SC-form filing */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-navy-3">
          File / advance SC form
        </div>
        {scForms.length > 0 ? (
          <p className="mt-1 text-[11px] text-navy-3">
            {scForms.map((s) => `${s.scForm} · ${s.statusLabel}`).join(" · ")}
          </p>
        ) : null}
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <select
              value={scForm}
              onChange={(e) => setScForm(e.target.value)}
              className="flex-1 rounded-md border border-border-2 bg-bg px-2 py-1.5 text-[12px] text-navy"
            >
              {SC_FORM_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select
              value={scStatus}
              onChange={(e) => setScStatus(e.target.value)}
              className="flex-1 rounded-md border border-border-2 bg-bg px-2 py-1.5 text-[12px] text-navy"
            >
              {SC_STATUS_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <input
            value={waecRef}
            onChange={(e) => setWaecRef(e.target.value)}
            placeholder="WAEC ref (e.g. SC-12-184-2026-0044)"
            className="w-full rounded-md border border-border-2 bg-bg px-2 py-1.5 font-mono text-[12px] text-navy"
          />
          <textarea
            value={scNotes}
            onChange={(e) => setScNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className="w-full rounded-md border border-border-2 bg-bg px-2 py-1.5 text-[12px] text-navy"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  fileScForm({
                    candidateId,
                    scForm,
                    status: scStatus,
                    waecRef: waecRef || undefined,
                    notes: scNotes || undefined,
                  }),
                setScResult,
              )
            }
            className="rounded-md border border-border-2 bg-surface px-4 py-2 text-[12px] font-semibold text-navy hover:bg-gold-bg disabled:opacity-50"
          >
            File SC form
          </button>
        </div>
        <Msg result={scResult} />
      </div>
    </div>
  );
}
