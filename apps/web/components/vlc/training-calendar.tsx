"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { recordTrainingAbsence, scheduleTraining } from "@/lib/actions/vlc-peer-guides";
import type { ActivePeerGuide, TrainingRow } from "@/lib/vlc/peer-guides-data";

/**
 * Monthly PG training calendar (Lucy INCR-41 §2.6). One row per training with the DONE / NEXT / FUTURE
 * status DERIVED from the date (never stored) and an attendance mini-bar derived from the present-by-
 * default absence rows. "Plan next training" (write-gated) creates an event; "Take attendance"
 * (write-gated, on a training whose date has arrived) captures present/absent per active PG — present is
 * the absence of a row. This is TRAINING attendance only — INCR-41 introduces NO class-session register
 * (that is INCR-42).
 */
export function TrainingCalendar({
  trainings,
  activePeerGuides,
  canEdit,
}: {
  trainings: TrainingRow[];
  activePeerGuides: ActivePeerGuide[];
  canEdit: boolean;
}) {
  const [planOpen, setPlanOpen] = useState(false);
  const [attendFor, setAttendFor] = useState<TrainingRow | null>(null);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => setPlanOpen(true)}
            className="rounded-md border border-border-2 bg-surface px-3.5 py-2 text-xs font-semibold text-navy hover:bg-gold-bg"
          >
            Plan next training
          </button>
        </div>
      )}

      {trainings.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-navy-3">
          No trainings scheduled for this academic year yet.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {trainings.map((t) => (
            <TrainingRowView
              key={t.id}
              t={t}
              canEdit={canEdit}
              onAttend={() => setAttendFor(t)}
            />
          ))}
        </div>
      )}

      <PlanTrainingModal open={planOpen} onClose={() => setPlanOpen(false)} />
      <AttendanceModal
        training={attendFor}
        activePeerGuides={activePeerGuides}
        onClose={() => setAttendFor(null)}
      />
    </div>
  );
}

function TrainingRowView({
  t,
  canEdit,
  onAttend,
}: {
  t: TrainingRow;
  canEdit: boolean;
  onAttend: () => void;
}) {
  const rowBg =
    t.status === "NEXT" ? "border-l-[3px] border-gold bg-gold-bg" : t.status === "FUTURE" ? "opacity-65" : "bg-bg";
  const pill =
    t.status === "DONE"
      ? "bg-green-bg text-green"
      : t.status === "NEXT"
        ? "bg-gold text-navy"
        : "border border-border-2 text-navy-3";
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-md px-3 py-3 ${rowBg}`}>
      <div className="flex h-11 w-14 shrink-0 flex-col items-center justify-center rounded-md border border-border-2 bg-surface">
        <span className="font-mono text-base font-semibold leading-none text-navy">{t.day}</span>
        <span className="font-mono text-[9px] uppercase text-navy-3">{t.month}</span>
      </div>
      <div className="min-w-[180px] flex-1">
        <div className="text-[13px] font-semibold text-navy">{t.title}</div>
        {t.description && <div className="text-[11px] text-navy-3">{t.description}</div>}
      </div>
      <div className="font-mono text-[11px] text-navy-3">{t.durationLabel}</div>
      <div className="w-[130px]">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full bg-green"
            style={{ width: `${t.pct ?? 0}%` }}
          />
        </div>
        <div className="mt-1 text-[10px] text-navy-3">{t.attendanceLabel}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${pill}`}>
          {t.status}
          {t.status === "NEXT" && t.weekday ? ` · ${t.weekday}` : ""}
        </span>
        {canEdit && t.status !== "FUTURE" && (
          <button
            onClick={onAttend}
            className="text-[10px] font-semibold text-navy underline-offset-2 hover:underline"
          >
            Take attendance
          </button>
        )}
      </div>
    </div>
  );
}

function PlanTrainingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [durationMin, setDurationMin] = useState("90");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await scheduleTraining({
        title,
        scheduledDate,
        durationMin: Number(durationMin),
        description: description.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not schedule.");
        return;
      }
      setTitle("");
      setScheduledDate("");
      setDurationMin("90");
      setDescription("");
      onClose();
      router.refresh();
    });
  }

  const field =
    "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold focus:bg-surface";

  return (
    <Modal open={open} onClose={() => (pending ? undefined : onClose())} title="Plan a training">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-navy-3">Title</span>
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="flex gap-3">
          <label className="block flex-1">
            <span className="mb-0.5 block text-[11px] font-medium text-navy-3">Date</span>
            <input
              type="date"
              className={field}
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
          </label>
          <label className="block w-28">
            <span className="mb-0.5 block text-[11px] font-medium text-navy-3">Minutes</span>
            <input
              type="number"
              min={1}
              max={600}
              className={field}
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-navy-3">Description (optional)</span>
          <input
            className={field}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {error && <p className="text-xs font-semibold text-terra">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={pending}
            className="text-sm font-semibold text-navy-2 hover:text-navy disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg hover:bg-navy-deep disabled:opacity-60"
          >
            {pending ? "Saving…" : "Schedule training"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AttendanceModal({
  training,
  activePeerGuides,
  onClose,
}: {
  training: TrainingRow | null;
  activePeerGuides: ActivePeerGuide[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const absentSet = new Set(training?.absentPeerGuideIds ?? []);

  function toggle(peerGuideId: string, makeAbsent: boolean) {
    if (!training) return;
    setError(null);
    startTransition(async () => {
      const res = await recordTrainingAbsence({
        trainingId: training.id,
        peerGuideId,
        present: !makeAbsent,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not update.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Modal
      open={!!training}
      onClose={() => (pending ? undefined : onClose())}
      title={training ? `Attendance · ${training.title}` : "Attendance"}
    >
      <div className="space-y-3">
        <p className="text-[12px] text-navy-3">
          Everyone is present by default — mark only the Peer Guides who were absent.
        </p>
        {activePeerGuides.length === 0 ? (
          <p className="text-[13px] text-navy-3">No active Peer Guides to record.</p>
        ) : (
          <div className="max-h-[320px] space-y-1 overflow-y-auto">
            {activePeerGuides.map((pg) => {
              const absent = absentSet.has(pg.peerGuideId);
              return (
                <div
                  key={pg.peerGuideId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-navy">{pg.name}</div>
                    <div className="text-[10px] text-navy-3">{pg.className}</div>
                  </div>
                  <button
                    onClick={() => toggle(pg.peerGuideId, !absent)}
                    disabled={pending}
                    className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                      absent ? "bg-terra text-bg" : "border border-border-2 bg-surface text-navy-3"
                    }`}
                  >
                    {absent ? "Absent" : "Present"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {error && <p className="text-xs font-semibold text-terra">{error}</p>}
        <div className="flex justify-end">
          <button
            onClick={onClose}
            disabled={pending}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg hover:bg-navy-deep disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
