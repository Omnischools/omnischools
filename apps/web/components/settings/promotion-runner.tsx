"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { runPromotion, type PromotionPreview } from "@/lib/actions/promotion";
import { Modal } from "@/components/ui/modal";

const ACTION_BADGE: Record<string, string> = {
  PROMOTE: "bg-green-bg text-green",
  GRADUATE: "bg-gold-bg text-gold",
  NO_TARGET: "bg-warn-bg text-warn",
  UNMATCHED: "bg-bg text-navy-3 border border-border-2",
};
const ACTION_LABEL: Record<string, string> = {
  PROMOTE: "Promote",
  GRADUATE: "Graduate",
  NO_TARGET: "No next class",
  UNMATCHED: "Not on ladder",
};

export function PromotionRunner({ preview }: { preview: PromotionPreview }) {
  const router = useRouter();
  const [hold, setHold] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | {
    promoted: number;
    graduated: number;
    heldBack: number;
    skipped: number;
    nextYearCreated: boolean;
  }>(null);

  const toggle = (id: string) =>
    setHold((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Live counts reflecting hold-backs.
  const live = useMemo(() => {
    let promote = 0;
    let graduate = 0;
    for (const r of preview.rows) {
      if (hold.has(r.studentId)) continue;
      if (r.action === "PROMOTE") promote++;
      else if (r.action === "GRADUATE") graduate++;
    }
    return { promote, graduate, heldBack: hold.size };
  }, [preview.rows, hold]);

  const needsAttention = preview.counts.noTarget + preview.counts.unmatched;

  async function run() {
    setBusy(true);
    setError(null);
    const res = await runPromotion({ holdBackIds: Array.from(hold) });
    setBusy(false);
    setConfirm(false);
    if (res.ok) {
      setDone(res);
      router.refresh();
    } else setError(res.error ?? "Could not run the promotion.");
  }

  if (done) {
    return (
      <div className="rounded-xl border border-green-bg bg-green-bg p-6">
        <h2 className="font-display text-lg font-semibold text-navy">Promotion complete</h2>
        <p className="mt-1 text-sm text-navy-2">
          Promoted <b className="text-navy">{done.promoted}</b>, graduated{" "}
          <b className="text-navy">{done.graduated}</b>, held back{" "}
          <b className="text-navy">{done.heldBack}</b>
          {done.skipped ? (
            <>
              , left <b className="text-navy">{done.skipped}</b> for manual handling
            </>
          ) : null}
          .{" "}
          {done.nextYearCreated
            ? `${preview.nextYear}'s terms were created.`
            : `${preview.nextYear}'s terms already existed.`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-warn-bg bg-warn-bg p-5">
        <div className="font-display text-base font-semibold text-navy">
          {preview.currentYear} → {preview.nextYear}
        </div>
        <p className="mt-1 text-sm text-navy-2">
          This moves every active student up one class and graduates the exit year. Review
          below and tick <b className="text-navy">Hold back</b> for anyone repeating.
          It can&apos;t be easily undone, so nothing changes until you confirm.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Chip tone="bg-green-bg text-green" label={`${live.promote} to promote`} />
        <Chip tone="bg-gold-bg text-gold" label={`${live.graduate} to graduate`} />
        <Chip tone="bg-bg text-navy-3" label={`${live.heldBack} held back`} />
        {needsAttention > 0 && (
          <Chip tone="bg-warn-bg text-warn" label={`${needsAttention} need attention`} />
        )}
      </div>

      {error && (
        <p className="rounded-md bg-terra-bg px-3 py-2 text-sm text-terra">{error}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
            <tr>
              <th className="px-4 py-3 font-semibold">Student</th>
              <th className="px-4 py-3 font-semibold">From</th>
              <th className="px-4 py-3 font-semibold">Next</th>
              <th className="px-4 py-3 text-right font-semibold">Hold back</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {preview.rows.map((r) => {
              const held = hold.has(r.studentId);
              const canHold = r.action === "PROMOTE" || r.action === "GRADUATE";
              return (
                <tr key={r.studentId} className={held ? "bg-bg" : ""}>
                  <td className="px-4 py-2.5">
                    <div className={`font-medium ${held ? "text-navy-3" : "text-navy"}`}>
                      {r.name}
                    </div>
                    <div className="font-mono text-[11px] text-navy-3">{r.code}</div>
                  </td>
                  <td className="px-4 py-2.5 text-navy-2">{r.fromClass}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold ${ACTION_BADGE[r.action]}`}
                    >
                      {r.action === "PROMOTE"
                        ? `→ ${r.toClass}`
                        : ACTION_LABEL[r.action]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canHold ? (
                      <input
                        type="checkbox"
                        checked={held}
                        onChange={() => toggle(r.studentId)}
                        className="h-4 w-4 accent-navy"
                        aria-label={`Hold back ${r.name}`}
                      />
                    ) : (
                      <span className="text-xs text-navy-3">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={live.promote + live.graduate === 0}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          Run promotion
        </button>
      </div>

      <Modal
        open={confirm}
        onClose={busy ? () => {} : () => setConfirm(false)}
        title={`Promote to ${preview.nextYear}?`}
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-navy-2">
            You&apos;re about to promote <b className="text-navy">{live.promote}</b>{" "}
            student{live.promote === 1 ? "" : "s"}, graduate{" "}
            <b className="text-navy">{live.graduate}</b>, and hold back{" "}
            <b className="text-navy">{live.heldBack}</b>.
            {!preview.nextYearExists
              ? ` ${preview.nextYear}'s terms will be created from this year's dates.`
              : ""}{" "}
            This can&apos;t be easily undone.
          </p>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setConfirm(false)}
              disabled={busy}
              className="text-sm font-semibold text-navy-2 transition-colors hover:text-navy disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
            >
              {busy ? "Promoting…" : "Yes, promote"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Chip({ tone, label }: { tone: string; label: string }) {
  return (
    <span className={`rounded-pill px-3 py-1 text-xs font-semibold ${tone}`}>{label}</span>
  );
}
