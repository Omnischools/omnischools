"use client";
import { useState } from "react";

export type TrendPoint = { date: string; pct: number };
export type TermTrendData = {
  school: TrendPoint[];
  male: TrendPoint[];
  female: TrendPoint[];
  byClass: { name: string; points: TrendPoint[] }[];
  holidays: { name: string; startsOn: string; endsOn: string }[];
  termStart: string;
  termEnd: string;
  today: string;
};

const W = 720;
const H = 220;
const PAD = { t: 12, r: 12, b: 22, l: 30 };
const Y_MIN = 50;
const Y_MAX = 100;
const days = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

const CLASS_COLORS = [
  "#1A2B47",
  "#C8975B",
  "#3E7C5A",
  "#B5552E",
  "#7B6CA8",
  "#2F7D8C",
  "#9C6B3F",
];

export function TermTrend({ data }: { data: TermTrendData }) {
  const [view, setView] = useState<"school" | "gender" | "class">("school");
  const span = Math.max(1, days(data.termStart, data.termEnd));
  const x = (d: string) =>
    PAD.l + (days(data.termStart, d) / span) * (W - PAD.l - PAD.r);
  const y = (p: number) =>
    PAD.t +
    (1 - (Math.min(Y_MAX, Math.max(Y_MIN, p)) - Y_MIN) / (Y_MAX - Y_MIN)) *
      (H - PAD.t - PAD.b);
  const path = (pts: TrendPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.date).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(" ");

  const lines =
    view === "school"
      ? [{ name: "School", points: data.school, color: "#1A2B47" }]
      : view === "gender"
        ? [
            { name: "Boys", points: data.male, color: "#1A2B47" },
            { name: "Girls", points: data.female, color: "#C8975B" },
          ]
        : data.byClass.map((c, i) => ({
            name: c.name,
            points: c.points,
            color: CLASS_COLORS[i % CLASS_COLORS.length],
          }));

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-xs">
          {lines.map((l) => (
            <span key={l.name} className="flex items-center gap-1.5 text-navy-2">
              <span className="h-2 w-3 rounded-sm" style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(
            [
              ["school", "School"],
              ["class", "By class"],
              ["gender", "By gender"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={`rounded-pill px-2.5 py-1 text-xs font-semibold transition-colors ${
                view === k
                  ? "bg-navy text-bg"
                  : "border border-border-2 bg-surface text-navy-2 hover:border-gold"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily attendance trend">
        {/* y gridlines + labels */}
        {[60, 70, 80, 90, 100].map((g) => (
          <g key={g}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(g)}
              y2={y(g)}
              stroke={g === 90 ? "#C8975B" : "#E7E3DC"}
              strokeWidth={g === 90 ? 1 : 0.5}
              strokeDasharray={g === 90 ? "4 3" : undefined}
            />
            <text x={4} y={y(g) + 3} className="fill-navy-3" fontSize="9">
              {g}
            </text>
          </g>
        ))}
        {/* holiday bands */}
        {data.holidays
          .filter((h) => h.endsOn >= data.termStart && h.startsOn <= data.termEnd)
          .map((h, i) => {
            const x1 = x(h.startsOn < data.termStart ? data.termStart : h.startsOn);
            const x2 = x(h.endsOn > data.termEnd ? data.termEnd : h.endsOn);
            return (
              <rect
                key={i}
                x={Math.min(x1, x2)}
                y={PAD.t}
                width={Math.max(2, Math.abs(x2 - x1))}
                height={H - PAD.t - PAD.b}
                fill="#C8975B"
                opacity={0.1}
              >
                <title>{h.name}</title>
              </rect>
            );
          })}
        {/* today marker */}
        {data.today >= data.termStart && data.today <= data.termEnd && (
          <line
            x1={x(data.today)}
            x2={x(data.today)}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="#C8975B"
            strokeWidth={1}
          />
        )}
        {/* series */}
        {lines.map((l) => (
          <path
            key={l.name}
            d={path(l.points)}
            fill="none"
            stroke={l.color}
            strokeWidth={1.75}
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  );
}
