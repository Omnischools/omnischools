"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reassignBunk } from "@/lib/actions/boarding";
import {
  PREFECT_LABEL,
  type BunkState,
  type PrefectSlot,
  type RosterDorm,
  type RosterOccupant,
} from "@/lib/boarding/roster";

type HouseCtx = { id: string; name: string; gender: "BOYS" | "GIRLS" | "COED" | null };

export interface RosterBoardProps {
  house: HouseCtx;
  dorms: RosterDorm[];
  unallocated: RosterOccupant[];
  prefects: PrefectSlot[];
  canReassign: boolean;
}

/** The four bunk states → BRAND tokens (never house.colour). Precedence is already resolved in
 *  the data layer; this only maps a state to its classes. */
const STATE_CLASS: Record<BunkState, string> = {
  prefect: "bg-gold-bg border-gold",
  flagged: "border-terra bg-terra-bg border-[1.5px]",
  moved: "bg-green-bg border-green",
  occupied: "bg-bg border-border",
  vacant: "border-2 border-dashed border-border-2 bg-surface italic text-navy-3",
};
const DOT_CLASS: Partial<Record<BunkState, string>> = {
  prefect: "bg-gold",
  flagged: "bg-terra",
  moved: "bg-green",
};

export function RosterBoard({
  house,
  dorms,
  unallocated,
  prefects,
  canReassign,
}: RosterBoardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedBunkId, setSelectedBunkId] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ studentId: string; name: string } | null>(null);
  const [target, setTarget] = useState<{ bunkId: string; address: string } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const bunkById = useMemo(() => {
    const m = new Map<string, { occupant: RosterOccupant | null; address: string }>();
    for (const d of dorms)
      for (const b of d.bunks) m.set(b.id, { occupant: b.occupant, address: b.address });
    return m;
  }, [dorms]);

  const selected = selectedBunkId ? bunkById.get(selectedBunkId)?.occupant ?? null : null;

  function onBunkClick(bunkId: string, state: BunkState) {
    setError(null);
    if (moving && state === "vacant") {
      const b = bunkById.get(bunkId);
      setTarget({ bunkId, address: b?.address ?? "that bunk" });
      return;
    }
    // Clicking an occupied bunk shows the student; clicking vacant (not moving) is a no-op hint.
    setSelectedBunkId(bunkId);
  }

  function beginMove(occ: RosterOccupant) {
    setMoving({ studentId: occ.studentId, name: occ.fullName });
    setError(null);
  }
  function cancelMove() {
    setMoving(null);
    setTarget(null);
    setReason("");
    setError(null);
  }

  function submit() {
    if (!moving || !target) return;
    setError(null);
    startTransition(async () => {
      const res = await reassignBunk({
        studentId: moving.studentId,
        targetBunkId: target.bunkId,
        reason,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not reassign the bunk.");
        return;
      }
      cancelMove();
      setSelectedBunkId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Prefect strip — display-only (appointment workflow is a later increment). */}
      <div className="rounded-xl border border-gold-soft bg-gold-bg p-5">
        <div className="mb-3.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
          House prefects ·{" "}
          <em className="font-medium not-italic text-navy">five roles, display-only</em>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {prefects.map((p) => (
            <div
              key={p.role}
              className={`flex items-center gap-2.5 rounded-lg border p-3 ${
                p.occupant ? "border-gold bg-surface" : "border-dashed border-border-2 bg-surface"
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy font-display text-[11px] font-bold text-gold">
                {p.occupant ? p.occupant.name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() : "—"}
              </span>
              <div className="min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-navy-3">
                  {PREFECT_LABEL[p.role]}
                </div>
                <div className="truncate text-xs font-bold text-navy">
                  {p.occupant ? p.occupant.name : "Vacant"}
                </div>
                <div className="text-[9px] text-navy-3">
                  {p.occupant
                    ? `${p.occupant.formLabel ?? "—"} · ${p.addressShort}`
                    : "No appointment"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Unallocated tray (J1) — boarders with no bunk. */}
      {unallocated.length > 0 && (
        <div className="rounded-xl border border-warn bg-warn-bg p-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-warn">
            Unallocated boarders · {unallocated.length} awaiting a bunk
          </div>
          <div className="flex flex-wrap gap-2">
            {unallocated.map((u) => (
              <button
                key={u.studentId}
                onClick={() => beginMove(u)}
                disabled={!canReassign}
                className="rounded-md border border-border-2 bg-surface px-2.5 py-1 text-xs font-semibold text-navy disabled:opacity-60"
              >
                {u.fullName}
                {canReassign && <span className="ml-1 text-navy-3">· place</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Move banner */}
      {moving && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gold bg-gold-bg px-4 py-2.5 text-sm">
          <span className="text-navy-2">
            Moving <b className="text-navy">{moving.name}</b> — click a{" "}
            <span className="italic">vacant</span> bunk in {house.name} to place them.
          </span>
          <button
            onClick={cancelMove}
            className="rounded-md border border-border-2 bg-surface px-3 py-1 text-xs font-semibold text-navy"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Dormitory grid — data-driven N dorms × M bunks. */}
      {dorms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-10 text-center text-sm text-navy-3">
          No dormitories configured for {house.name} yet. Boarders show in the unallocated tray
          until dorms and bunks are set up.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {dorms.map((d) => (
            <div key={d.id} className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex items-start justify-between border-b border-border bg-bg px-4 py-3">
                <div>
                  <h5 className="font-display text-base font-semibold text-navy">
                    Dorm {d.name}
                    {d.sectionLabel && (
                      <em className="italic text-gold"> · {d.sectionLabel}</em>
                    )}
                  </h5>
                  <div className="mt-0.5 text-[10px] text-navy-3">
                    {d.filled} of {d.total} occupied
                  </div>
                </div>
                <span
                  className={`rounded-pill px-2.5 py-0.5 text-[9px] font-bold ${
                    d.filled >= d.total
                      ? "bg-warn-bg text-warn"
                      : d.filled === 0
                        ? "border border-border bg-bg text-navy-3"
                        : "bg-green-bg text-green"
                  }`}
                >
                  {d.filled} / {d.total}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5 p-3.5">
                {d.bunks.map((b) => {
                  const isTargetable = !!moving && b.state === "vacant";
                  const isSelected = b.id === selectedBunkId;
                  return (
                    <button
                      key={b.id}
                      onClick={() => onBunkClick(b.id, b.state)}
                      title={b.address}
                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[10px] ${
                        STATE_CLASS[b.state]
                      } ${isTargetable ? "ring-2 ring-gold" : ""} ${
                        isSelected ? "ring-2 ring-navy" : ""
                      }`}
                    >
                      {DOT_CLASS[b.state] && (
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[b.state]}`}
                        />
                      )}
                      <span
                        className={`font-mono text-[9px] font-semibold ${
                          b.state === "prefect"
                            ? "text-gold"
                            : b.state === "flagged"
                              ? "text-terra"
                              : "text-navy-3"
                        }`}
                      >
                        {b.posLabel}
                      </span>
                      {b.occupant ? (
                        <span className="min-w-0 flex-1 truncate font-semibold text-navy">
                          {b.occupant.name}
                          {b.state === "prefect" ? " *" : ""}
                        </span>
                      ) : (
                        <span className="flex-1 text-center">empty</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Student detail card — neutral default, terra when pastorally flagged. */}
      {selected && (
        <DetailCard
          occupant={selected}
          houseName={house.name}
          canReassign={canReassign}
          onMove={() => beginMove(selected)}
          onClose={() => setSelectedBunkId(null)}
        />
      )}

      {/* Reason dialog for a chosen target bunk. */}
      {target && moving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl">
            <h3 className="font-display text-lg font-semibold text-navy">
              Move {moving.name}
            </h3>
            <p className="mt-1 text-sm text-navy-3">
              To <b className="text-navy-2">{target.address}</b>. A reason is required — it is
              written to this boarder&apos;s append-only allocation history.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="e.g. Moved nearer the Prep prefect at parent's request"
              className="mt-3 w-full rounded-md border border-border-2 bg-bg p-2.5 text-sm text-navy outline-none focus:border-gold"
            />
            {error && <p className="mt-2 text-xs font-semibold text-terra">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setTarget(null);
                  setReason("");
                  setError(null);
                }}
                disabled={pending}
                className="rounded-md border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={submit}
                disabled={pending || reason.trim().length === 0}
                className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
              >
                {pending ? "Moving…" : "Confirm move"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailCard({
  occupant,
  houseName,
  canReassign,
  onMove,
  onClose,
}: {
  occupant: RosterOccupant;
  houseName: string;
  canReassign: boolean;
  onMove: () => void;
  onClose: () => void;
}) {
  const flagged = occupant.flagged;
  return (
    <div
      className={`overflow-hidden rounded-xl border bg-surface ${
        flagged ? "border-terra" : "border-border"
      }`}
    >
      <div
        className={`flex items-center gap-4 border-b px-5 py-4 ${
          flagged ? "border-terra bg-terra-bg" : "border-border bg-bg"
        }`}
      >
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-display text-lg font-semibold text-bg ${
            flagged ? "bg-terra" : "bg-navy"
          }`}
        >
          {occupant.name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()}
        </span>
        <div className="flex-1">
          <div
            className={`text-[10px] font-bold uppercase tracking-[0.12em] ${
              flagged ? "text-terra" : "text-navy-3"
            }`}
          >
            {occupant.formLabel ?? "Boarder"} · {houseName} House
          </div>
          <h4 className="font-display text-lg font-semibold text-navy">{occupant.fullName}</h4>
          {occupant.allocatedAtLabel && (
            <div className="mt-0.5 text-[11px] text-navy-2">
              Allocated {occupant.allocatedAtLabel}
              {occupant.allocationReason ? ` · ${occupant.allocationReason}` : ""}
            </div>
          )}
        </div>
        {flagged && (
          <span className="rounded-pill bg-terra px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-bg">
            Pastoral flag
          </span>
        )}
        <button
          onClick={onClose}
          className="rounded-md border border-border-2 bg-surface px-2.5 py-1 text-xs font-semibold text-navy"
        >
          Close
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        {flagged && (
          <p className="flex-1 text-[12px] italic text-navy-3">
            A pastoral flag is set on this boarder. The full case file arrives with the pastoral
            (VLC) module — it is not part of this release.
          </p>
        )}
        {!flagged && (
          <p className="flex-1 text-[12px] text-navy-3">
            {occupant.movedThisSem
              ? "Moved to this bunk during the current semester."
              : "Settled in this bunk since allocation."}
          </p>
        )}
        {canReassign && (
          <button
            onClick={onMove}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg hover:bg-navy-deep"
          >
            Move within House
          </button>
        )}
      </div>
    </div>
  );
}
