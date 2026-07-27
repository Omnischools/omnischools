"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { appointPeerGuide, endPeerGuide } from "@/lib/actions/vlc-peer-guides";
import { VLC_NO_PG_BY_POLICY, VLC_VACANCY_PROTOCOL } from "@/lib/vlc/defaults";
import type { PeerGuideSlot, RosterClass } from "@/lib/vlc/peer-guides-data";

/**
 * Per-class Peer Guide roster (Lucy INCR-41 §2.4/§2.5). Form-1 classes render the "no Peer Guides by
 * policy" card (no slots, no affordance — structural, not a vacancy); F2/F3 classes render two slots
 * (boy/girl styling from the PG's sex) with the empty-slot + `.gap` state when < 2 active. The Dean-facing
 * vacancy callout + the appoint / step-aside mutations live here (write-gated by `canEdit` and re-checked
 * server-side). No ballot / candidates / vote-date (OC2 — the vote is offline, the Dean records the
 * outcome): "record replacement" is just an appointment into a vacant slot.
 */
export function PeerGuideRoster({
  classes,
  canEdit,
}: {
  classes: RosterClass[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"ALL" | "1" | "2" | "3">("ALL");
  const [appointFor, setAppointFor] = useState<RosterClass | null>(null);
  const [pickStudent, setPickStudent] = useState<string>("");
  const [endTarget, setEndTarget] = useState<{ slot: PeerGuideSlot; className: string } | null>(null);
  const [endReason, setEndReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const vacancies = useMemo(() => classes.filter((c) => c.vacancy), [classes]);
  const shown = useMemo(
    () => (filter === "ALL" ? classes : classes.filter((c) => String(c.form) === filter)),
    [classes, filter],
  );

  function openAppoint(c: RosterClass) {
    setError(null);
    setPickStudent("");
    setAppointFor(c);
  }

  function submitAppoint() {
    if (!appointFor || !pickStudent) {
      setError("Pick a student to appoint.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await appointPeerGuide({ studentId: pickStudent, classId: appointFor.classId });
      if (!res.ok) {
        setError(res.error ?? "Could not appoint.");
        return;
      }
      setAppointFor(null);
      router.refresh();
    });
  }

  function submitEnd() {
    if (!endTarget) return;
    setError(null);
    startTransition(async () => {
      const res = await endPeerGuide({
        peerGuideId: endTarget.slot.peerGuideId,
        reason: endReason.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not update.");
        return;
      }
      setEndTarget(null);
      setEndReason("");
      router.refresh();
    });
  }

  if (classes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border-2 bg-bg p-10 text-center">
        <div className="font-display text-lg font-medium text-navy">No Peer Guides selected yet</div>
        <p className="mt-1 text-[13px] text-navy-3">
          No classes are configured for this school yet · Peer Guides are appointed in Form 2 and Form 3
          classes each semester.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Vacancy callout (Dean-facing · no ballot) ── */}
      {vacancies.length > 0 && (
        <div className="rounded-2xl border border-terra bg-terra-bg p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-terra font-display text-sm font-bold text-bg">
                  !
                </span>
                <h4 className="font-display text-lg font-semibold text-navy">
                  {vacancies.length === 1 ? "Open vacancy" : `${vacancies.length} open vacancies`}{" "}
                  <em className="italic text-terra">
                    · {vacancies.map((v) => v.name).join(", ")}
                  </em>
                </h4>
              </div>
              <ul className="mt-2 max-w-3xl list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-navy-2">
                {VLC_VACANCY_PROTOCOL.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Form filter ── */}
      <div className="flex flex-wrap gap-1.5">
        {(["ALL", "1", "2", "3"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-pill border px-3 py-1 text-[11px] font-semibold transition-colors ${
              filter === f
                ? "border-navy bg-navy text-bg"
                : "border-border-2 bg-surface text-navy-3 hover:bg-gold-bg"
            }`}
          >
            {f === "ALL" ? "All forms" : `Form ${f}`}
          </button>
        ))}
      </div>

      {/* ── Classes grid ── */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((c) =>
          c.eligible ? (
            <SlotCard key={c.classId} c={c} canEdit={canEdit} onAppoint={() => openAppoint(c)} onEnd={setEndTarget} />
          ) : (
            <PolicyCard key={c.classId} c={c} />
          ),
        )}
      </div>

      {/* ── Appoint modal ── */}
      <Modal
        open={!!appointFor}
        onClose={() => (pending ? undefined : setAppointFor(null))}
        title={appointFor ? `Appoint a Peer Guide · ${appointFor.name}` : "Appoint a Peer Guide"}
      >
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-navy-2">
            The class vote is held offline — record the elected student here. Gender balance (one boy, one
            girl) is advisory, not enforced.
          </p>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-navy-3">Student</span>
            <select
              value={pickStudent}
              onChange={(e) => setPickStudent(e.target.value)}
              className="w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold focus:bg-surface"
            >
              <option value="">Select a student…</option>
              {appointFor?.candidates.map((s) => (
                <option key={s.studentId} value={s.studentId}>
                  {s.name} · {s.sex === "MALE" ? "boy" : "girl"}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="text-xs font-semibold text-terra">{error}</p>}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => setAppointFor(null)}
              disabled={pending}
              className="text-sm font-semibold text-navy-2 hover:text-navy disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={submitAppoint}
              disabled={pending}
              className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-soft disabled:opacity-60"
            >
              {pending ? "Recording…" : "Record appointment"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Step-aside confirm ── */}
      <ConfirmDialog
        open={!!endTarget}
        title="Record a step-aside"
        tone="gold"
        confirmLabel="Record step-aside"
        busyLabel="Recording…"
        busy={pending}
        error={error}
        onClose={() => {
          setEndTarget(null);
          setEndReason("");
          setError(null);
        }}
        onConfirm={submitEnd}
        message={
          <div className="space-y-3">
            <p>
              {endTarget?.slot.name} steps aside as a Peer Guide of {endTarget?.className}. The
              appointment is closed (never deleted) and the slot becomes a vacancy — a replacement can be
              recorded for the rest of the semester.
            </p>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-navy-3">
                Reason (optional)
              </span>
              <input
                value={endReason}
                onChange={(e) => setEndReason(e.target.value)}
                placeholder="e.g. returning home weekends"
                className="w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold focus:bg-surface"
              />
            </label>
          </div>
        }
      />
    </div>
  );
}

function PolicyCard({ c }: { c: RosterClass }) {
  return (
    <div className="rounded-[10px] border border-border bg-bg p-4">
      <CardHead c={c} />
      <div className="mt-3 rounded-md border border-dashed border-border-2 bg-surface p-4 text-center">
        <div className="text-[12px] font-semibold text-navy">{VLC_NO_PG_BY_POLICY.title}</div>
        <div className="mt-1 text-[11px] italic text-navy-3">{VLC_NO_PG_BY_POLICY.body}</div>
      </div>
    </div>
  );
}

function SlotCard({
  c,
  canEdit,
  onAppoint,
  onEnd,
}: {
  c: RosterClass;
  canEdit: boolean;
  onAppoint: () => void;
  onEnd: (t: { slot: PeerGuideSlot; className: string }) => void;
}) {
  const empties = c.openSlots;
  return (
    <div
      className={`rounded-[10px] border p-4 ${c.vacancy ? "border-terra bg-terra-bg" : "border-border bg-surface"}`}
    >
      <CardHead c={c} vacancy={c.vacancy} />
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {c.slots.map((s) => (
          <FilledSlot key={s.peerGuideId} s={s} canEdit={canEdit} onEnd={() => onEnd({ slot: s, className: c.name })} />
        ))}
        {Array.from({ length: empties }).map((_, i) => (
          <EmptySlot key={`empty-${i}`} canEdit={canEdit} onAppoint={onAppoint} />
        ))}
      </div>
      {c.tenureLabel && (
        <div className="mt-3 flex items-center justify-between border-t border-dashed border-border-2 pt-2 text-[10px] text-navy-3">
          <span className="font-semibold uppercase tracking-[0.08em]">Tenure</span>
          <span className="font-mono text-navy-2">{c.tenureLabel}</span>
        </div>
      )}
    </div>
  );
}

function CardHead({ c, vacancy }: { c: RosterClass; vacancy?: boolean }) {
  const pill =
    c.form === 3
      ? "bg-green-bg text-green"
      : c.form === 2
        ? "bg-gold-bg text-gold"
        : "bg-border text-navy-3";
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <h4 className="font-display text-base font-semibold text-navy">{c.name}</h4>
        <div className="mt-0.5 text-[11px] text-navy-3">
          {[c.programmeLabel, `${c.studentCount} students`, c.fmName ? `${c.fmName} FM` : null]
            .filter(Boolean)
            .join(" · ")}
          {vacancy && <span className="font-semibold text-terra"> · vacancy open</span>}
        </div>
      </div>
      <span className={`shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-bold ${pill}`}>
        {c.formLabel}
      </span>
    </div>
  );
}

function FilledSlot({
  s,
  canEdit,
  onEnd,
}: {
  s: PeerGuideSlot;
  canEdit: boolean;
  onEnd: () => void;
}) {
  const boy = s.rep === "boy";
  return (
    <div
      className={`rounded-md border-l-[3px] bg-bg p-2.5 ${boy ? "border-navy" : "border-terra"}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-md font-display text-[11px] font-semibold ${
            boy ? "bg-navy text-gold" : "bg-terra text-bg"
          }`}
        >
          {s.initials}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-navy">{s.name}</div>
          <div className="text-[10px] text-navy-3">{s.roleLabel}</div>
        </div>
      </div>
      {canEdit && (
        <button
          onClick={onEnd}
          className="mt-2 text-[10px] font-semibold text-navy-3 underline-offset-2 hover:text-terra hover:underline"
        >
          Step aside
        </button>
      )}
    </div>
  );
}

function EmptySlot({ canEdit, onAppoint }: { canEdit: boolean; onAppoint: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-terra bg-terra-bg p-2.5 text-center">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-terra font-display text-[13px] font-bold text-bg">
        !
      </span>
      <div className="mt-1 text-[10px] font-semibold text-terra">Vacant</div>
      {canEdit && (
        <button
          onClick={onAppoint}
          className="mt-1 text-[10px] font-semibold text-navy underline-offset-2 hover:underline"
        >
          Record replacement
        </button>
      )}
    </div>
  );
}
