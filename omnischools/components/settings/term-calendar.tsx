import { isHoliday, schoolDaysInRange, termDayProgress, type HolidayRange } from "@/lib/school-calendar";

/**
 * Region 01 "School calendar" visual for the attendance settings surface
 * (Surfaces/schoolup-attendance-settings.html): a term boundary strip, a
 * week-strip "term at a glance" grid with a 6-item legend, and inline
 * full-width banners for multi-day holidays / exam weeks. Pure server render.
 */

const HATCH =
  "repeating-linear-gradient(45deg,#FAF7F2,#FAF7F2 3px,#D4CCBA 3px,#D4CCBA 4px)";
const DOW_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
};
const dowOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const dayNum = (iso: string) => Number(iso.slice(8, 10));
const fmtShort = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtFull = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

type Kind = "school" | "weekend" | "holiday" | "exam" | "future" | "today";

function kindOf(iso: string, today: string, holidays: HolidayRange[]): Kind {
  if (iso === today) return "today";
  const w = dowOf(iso);
  if (w === 0 || w === 6) return "weekend";
  const h = isHoliday(iso, holidays);
  if (h) return h.kind === "EXAM" ? "exam" : "holiday";
  if (iso > today) return "future";
  return "school";
}

const BANNER: Record<string, (range: HolidayRange, days: number) => string> = {
  PUBLIC: () => "public holiday · school closed",
  BREAK: (_r, d) => `${d} school day${d === 1 ? "" : "s"} · whole week off`,
  EVENT: () => "school event · attendance auto-marked",
  EXAM: (_r, d) => `${d} day${d === 1 ? "" : "s"} · attendance still tracked`,
};

export function TermCalendar({
  term,
  holidays,
  today,
}: {
  term: { label: string; startsOn: string; endsOn: string };
  holidays: HolidayRange[];
  today: string;
}) {
  const totalDays = schoolDaysInRange(term.startsOn, term.endsOn, holidays);
  const progress = termDayProgress(term.startsOn, term.endsOn, today, holidays);
  const counts = holidays.reduce<Record<string, number>>((m, h) => {
    m[h.kind] = (m[h.kind] ?? 0) + 1;
    return m;
  }, {});
  const holidayBlurb = (["PUBLIC", "BREAK", "EVENT", "EXAM"] as const)
    .filter((k) => counts[k])
    .map(
      (k) =>
        `${counts[k]} ${
          { PUBLIC: "public", BREAK: "mid-term", EVENT: "event", EXAM: "exam" }[k]
        }`,
    )
    .join(" · ");

  // Build Monday-anchored weeks across the term.
  const firstMonday = addDays(term.startsOn, -((dowOf(term.startsOn) + 6) % 7));
  const weeks: { wk: number; start: string; days: string[] }[] = [];
  let wk = 1;
  for (let ws = firstMonday; ws <= term.endsOn; ws = addDays(ws, 7)) {
    weeks.push({ wk, start: ws, days: Array.from({ length: 7 }, (_, i) => addDays(ws, i)) });
    wk++;
  }
  const holidayFor = (weekStart: string) =>
    holidays.filter((h) => h.startsOn >= weekStart && h.startsOn <= addDays(weekStart, 6));

  const boundary = [
    { lbl: "Term begins", val: fmtFull(term.startsOn).split(", ")[0], sub: "school days started" },
    {
      lbl: "Term ends",
      val: fmtFull(term.endsOn).split(", ")[0],
      sub: `${weeks.length} weeks · ${totalDays} school days`,
    },
    {
      lbl: "Days marked so far",
      val: `${progress.dayOf} of ${progress.total}`,
      sub: progress.total ? `${Math.round((progress.dayOf / progress.total) * 100)}% through term` : "—",
    },
    {
      lbl: "Holidays & closures",
      val: `${holidays.length} noted`,
      sub: holidayBlurb || "none yet",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Term boundary strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
        {boundary.map((c) => (
          <div key={c.lbl} className="bg-surface p-4">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">
              {c.lbl}
            </div>
            <div className="mt-1 font-display text-base font-semibold text-navy">{c.val}</div>
            <div className="mt-0.5 font-mono text-[10px] font-semibold text-navy-3">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Calendar strip */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
            Term at a glance
          </span>
          <div className="flex flex-wrap gap-2.5 text-[10px] text-navy-3">
            <Legend swatch="bg-green border-green">School day</Legend>
            <Legend swatch="bg-bg border-border-2">Weekend</Legend>
            <Legend swatchStyle={{ backgroundImage: HATCH }}>Holiday</Legend>
            <Legend swatch="bg-gold border-gold">Exam</Legend>
            <Legend swatch="bg-surface border-dashed border-border-2">Future</Legend>
          </div>
        </div>
        <div className="space-y-1.5">
          {weeks.map((w) => {
            const banners = holidayFor(w.start);
            return (
              <div key={w.start}>
                <div className="grid grid-cols-[64px_1fr] items-center gap-2">
                  <div className="leading-tight">
                    <div className="font-display text-xs font-semibold text-navy">Wk {w.wk}</div>
                    <div className="font-mono text-[9px] text-navy-3">{fmtShort(w.start)}</div>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {w.days.map((d) => {
                      const k = kindOf(d, today, holidays);
                      const content =
                        k === "holiday" || k === "exam" || k === "future"
                          ? dayNum(d)
                          : DOW_LETTER[dowOf(d)];
                      const base =
                        "flex h-7 items-center justify-center rounded font-display text-[11px] font-bold";
                      const cls =
                        k === "school"
                          ? "bg-green text-white"
                          : k === "exam"
                            ? "bg-gold text-navy"
                            : k === "weekend"
                              ? "bg-bg text-navy-3"
                              : k === "future"
                                ? "border border-dashed border-border-2 bg-surface text-border-2"
                                : k === "today"
                                  ? "bg-green text-white outline outline-2 -outline-offset-2 outline-gold"
                                  : "text-navy-3"; // holiday (hatch via style)
                      return (
                        <div
                          key={d}
                          title={fmtFull(d)}
                          className={`${base} ${cls}`}
                          style={k === "holiday" ? { backgroundImage: HATCH } : undefined}
                        >
                          {content}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {banners.map((h) => {
                  const days = schoolDaysInRange(h.startsOn, h.endsOn, []);
                  const exam = h.kind === "EXAM";
                  return (
                    <div
                      key={h.startsOn + h.name}
                      className={`mt-1.5 rounded-md border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide ${
                        exam
                          ? "border-gold-soft bg-gold-bg text-gold"
                          : "border-dashed border-border-2 bg-bg text-navy-2"
                      }`}
                    >
                      <span className="font-display normal-case italic text-gold">{h.name}</span>{" "}
                      · {(BANNER[h.kind] ?? BANNER.PUBLIC)(h, days)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Legend({
  swatch,
  swatchStyle,
  children,
}: {
  swatch?: string;
  swatchStyle?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-[3px] border ${swatch ?? "border-border"}`} style={swatchStyle} />
      {children}
    </span>
  );
}
