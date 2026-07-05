import "server-only";

/**
 * §01 "Today's activity · most recent first" — the activity-feed section of
 * Surfaces/schoolup-audit-log-viewer.html, fused above the existing audit table.
 * Server-rendered from the same audit_log rows; newest first, grouped under a day marker.
 * Entry cards carry a mono timestamp + relative "ago", a prose headline, module + severity
 * pills, and a severity tint (sensitive = warn, bulk = gold left-border).
 */

export type AuditEvent = {
  id: string;
  occurredAt: Date | string;
  actorName: string | null;
  actorRole: string | null;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
};

type DiffRow = { field: string; old: string; new: string };

const fieldLabel = (k: string) =>
  k
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();

function fmtVal(v: unknown): string {
  if (v == null) return "—";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 44 ? `${s.slice(0, 44)}…` : s;
}

/** Field-level before→after changes (only fields that actually differ). Empty for creates. */
function computeDiff(before: unknown, after: unknown): DiffRow[] {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") {
    return [];
  }
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  const rows: DiffRow[] = [];
  for (const k of keys) {
    const oldV = fmtVal(b[k]);
    const newV = fmtVal(a[k]);
    if (oldV !== newV) rows.push({ field: fieldLabel(k), old: oldV, new: newV });
  }
  return rows.slice(0, 6);
}

// Money / role / structural changes are "sensitive"; the rest are routine.
const SENSITIVE = new Set([
  "voided",
  "refunded",
  "deleted",
  "reassigned",
  "approved",
  "promoted",
  "closed",
  "reopened",
]);
// Actions that touch many records at once.
const BULK_ENTITIES = new Set(["invoice_batch", "school_year"]);

const title = (s?: string | null) =>
  s ? s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ") : "—";

function timeParts(occurredAt: Date | string, now: Date) {
  const d = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  const time = d.toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const min = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 60000));
  const ago =
    min < 1
      ? "just now"
      : min < 60
        ? `${min} min ago`
        : min < 1440
          ? `${Math.floor(min / 60)}h ago`
          : `${Math.floor(min / 1440)}d ago`;
  return { time, ago };
}

export function AuditActivityFeed({
  events,
  dayLabel,
}: {
  events: AuditEvent[];
  dayLabel: string;
}) {
  const now = new Date();

  return (
    <div>
      {/* Day marker */}
      <div className="mb-3 mt-1 flex items-center gap-3.5">
        <span className="h-px flex-1 bg-border" />
        <span className="shrink-0 px-1 font-display text-[13px] italic text-gold">
          {dayLabel}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-navy-2">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {events.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-border-2 bg-surface px-4 py-8 text-center text-sm text-navy-3">
          No activity recorded yet today.
        </p>
      ) : (
        <div className="space-y-2">
          {events.map((e) => {
            const { time, ago } = timeParts(e.occurredAt, now);
            const sensitive = SENSITIVE.has(e.actionType);
            const bulk = e.entityType ? BULK_ENTITIES.has(e.entityType) : false;
            const actor = e.actorName ?? title(e.actorRole) ?? "System";
            const moduleLabel = e.entityType ? title(e.entityType) : "System";
            const diff = computeDiff(e.before, e.after);
            return (
              <div
                key={e.id}
                className={`grid grid-cols-[auto_1fr] gap-4 rounded-[10px] border p-3.5 ${
                  sensitive ? "border-warn-bg bg-warn-bg" : "border-border bg-surface"
                } ${bulk ? "border-l-[3px] border-l-gold" : ""}`}
              >
                <div className="min-w-[58px] pt-0.5 font-mono text-[11px] font-semibold text-navy-2">
                  <div>{time}</div>
                  <div className="mt-0.5 text-[9px] font-medium text-navy-3">{ago}</div>
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] leading-relaxed text-navy">
                    <span className="font-bold">{actor}</span>{" "}
                    <span className="text-navy-2">{title(e.actionType)}</span>{" "}
                    <span className="font-semibold">{moduleLabel}</span>
                    {e.reason ? (
                      <span className="text-navy-2"> — {e.reason}</span>
                    ) : null}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-pill border border-border bg-bg px-2 py-0.5 text-[10px] font-semibold text-navy-2">
                      {moduleLabel}
                    </span>
                    <span
                      className={`rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] ${
                        sensitive ? "bg-warn text-white" : "bg-bg text-navy-3"
                      }`}
                    >
                      {sensitive ? "Sensitive" : "Routine"}
                    </span>
                    {bulk ? (
                      <span className="rounded-pill bg-gold px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-navy">
                        Bulk
                      </span>
                    ) : null}
                    {e.entityId ? (
                      <span className="font-mono text-[10px] text-navy-3">
                        {e.entityId.slice(0, 8)}
                      </span>
                    ) : null}
                  </div>

                  {/* Per-event diff (before → after) — surface §01 diff block */}
                  {diff.length > 0 ? (
                    <div className="mt-2 rounded-md border border-dashed border-border bg-bg p-2.5 font-mono text-[11px] leading-relaxed">
                      {diff.map((d) => (
                        <div
                          key={d.field}
                          className="grid grid-cols-[92px_1fr] gap-2.5 py-0.5"
                        >
                          <span className="pt-px text-[9px] font-semibold uppercase tracking-[0.06em] text-navy-3">
                            {d.field}
                          </span>
                          <span className="break-words text-navy-2">
                            <span className="text-terra line-through">{d.old}</span>
                            <span className="mx-1.5 text-navy-3">→</span>
                            <span className="font-bold text-green">{d.new}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
