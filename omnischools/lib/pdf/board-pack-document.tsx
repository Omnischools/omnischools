import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { SERIF, SANS, MONO } from "./fonts";
import {
  ATTENDANCE_STATUS_ORDER,
  ATTENDANCE_STATUS_META,
  type AttendanceStatus,
} from "@/lib/attendance-status";
import { armView, tierView, ghs, num, dash, pct } from "./board-pack-parts";
import type {
  SchoolRollup,
  RollupArm,
  EnrolmentArm,
  AttendanceArm,
  AttendanceStatusTotals,
  NetPositionFinanceArm,
  BooksFinanceLine,
  PayrollLine,
  FeeCollectionsArm,
  PerformanceArm,
  SeniorReadinessSummary,
  TerminalResultsArm,
  TerminalResultSummary,
  InfrastructureSummary,
} from "@/lib/rollup/school-rollup";
import type { ActionItem, InsightsAttendanceLevelRow } from "@/lib/insights/insights-data";
import type { LevelPerformance } from "@/lib/reports/class-performance-data";
import type { CensusEnrolment } from "@/lib/reports/census-enrolment-data";

/**
 * GOV-5 · the board-pack PDF (A4 portrait) — a print rendering of the GOV-4 board dashboard for a
 * board member / director. Presentational only: it is fed the SchoolRollup ARMS VERBATIM (never a
 * pre-flattened bag), so the honest-absence spine (`arm.status`) branches HERE exactly as the
 * dashboard branches — reading `arm.data` on a non-CAPTURED arm is a COMPILE ERROR (the boardTile
 * guarantee, now enforced in print). The route pre-formats only the date + initials + term label
 * (tz/locale/session data the doc must not reach for). Core PDF fonts stand in for the brand faces.
 */

// --- design tokens (hex; @react-pdf can't use CSS vars) ---
const NAVY = "#1A2B47";
const NAVY2 = "#2D3F5C";
const NAVY3 = "#5C6675";
const GOLD = "#C8975B";
const GOLD_SOFT = "#E8D4B8";
const GOLD_BG = "#F5EBDC";
const BG = "#FAF7F2";
const GREEN = "#2F6B47";
const GREEN_BG = "#E5EFE8";
const TERRA = "#B84A39";
const TERRA_BG = "#F5E1DC";
const WARN = "#C58A2E";
const BORDER = "#E5DFD3";

// Gender mini-bar — the school-stats pink/blue (a sanctioned non-token exception, as on the dashboard).
const FEMALE_HEX = "#C77B9E";
const MALE_HEX = "#6B86B0";

// The 5-status segmented bar: map each status's `.seg` Tailwind class to its hex for print. Medical (M,
// navy-2) stays its OWN segment — the sickbay→attendance readout, never folded into Absent.
const STATUS_HEX: Record<AttendanceStatus, string> = {
  PRESENT: GREEN,
  LATE: GOLD,
  EXCUSED: WARN,
  MEDICAL: NAVY2,
  ABSENT: TERRA,
};

export type BoardPackData = {
  /** The rollup arms verbatim — the document branches on each `arm.status` (§0.1 compile-fence). */
  rollup: SchoolRollup;
  // Director drill-downs (INS §17-F / #309) — the aggregate arms the /insights page adds beyond the
  // board rollup. All aggregate-only (year-group / age-band), never a per-student row. Both the board
  // and directors' packs carry them (the two surfaces are synced), so the document is shared, not cloned.
  attention: ActionItem[];
  levelPerf: LevelPerformance;
  attendanceByLevel: InsightsAttendanceLevelRow[];
  census: CensusEnrolment;
  meta: {
    schoolName: string;
    schoolInitials: string;
    termLabel: string; // "Term 2 · 2025/26" | "No academic period configured"
    generatedAtLabel: string; // route-formatted from rollup.generatedAt (school tz/locale)
  };
};

const s = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    fontFamily: SANS,
    fontSize: 10,
    color: NAVY,
    paddingTop: 10, // clears the fixed gold strip on every page
    paddingBottom: 44, // reserves room for the fixed footer
  },
  strip: { position: "absolute", top: 0, left: 0, right: 0, height: 6, backgroundColor: GOLD },

  // cover band (full width)
  cover: {
    backgroundColor: GOLD_BG,
    borderBottomWidth: 1,
    borderColor: GOLD_SOFT,
    alignItems: "center",
    paddingHorizontal: 40,
    paddingTop: 20,
    paddingBottom: 18,
  },
  mark: {
    width: 46,
    height: 46,
    backgroundColor: NAVY,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  markText: { fontFamily: SERIF, fontWeight: "bold", fontSize: 18, color: GOLD },
  coverSchool: { fontFamily: SERIF, fontWeight: "bold", fontSize: 22, color: NAVY, textAlign: "center" },
  coverTitle: { fontFamily: SERIF, fontSize: 13, color: NAVY, marginTop: 6, textAlign: "center" },
  coverTerm: { fontFamily: MONO, fontSize: 10, color: NAVY2, marginTop: 8 },
  coverGen: { fontSize: 8.5, color: NAVY3, marginTop: 3 },
  coverFraming: { fontSize: 9, color: NAVY3, marginTop: 6, textAlign: "center" },

  body: { paddingHorizontal: 40, paddingTop: 12 },

  // section
  section: { marginBottom: 16 },
  secHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 },
  secTitle: { fontFamily: SERIF, fontSize: 15, color: NAVY },
  secGold: { color: GOLD },
  secMeta: { fontSize: 9, color: NAVY3 },
  eyebrow: { fontSize: 8, color: NAVY3, fontWeight: "bold", letterSpacing: 1, marginBottom: 3 },

  headline: { fontFamily: SERIF, fontWeight: "bold", fontSize: 26, color: NAVY, lineHeight: 1 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  caption: { fontSize: 8.5, color: NAVY3 },

  // trend chip
  chip: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: "bold",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  chipUp: { color: GREEN, backgroundColor: GREEN_BG },
  chipDown: { color: TERRA, backgroundColor: TERRA_BG },
  chipFlat: { color: NAVY3, backgroundColor: BG },

  // segmented bars (gender / attendance)
  segTrack: {
    flexDirection: "row",
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    overflow: "hidden",
    marginTop: 8,
  },
  readoutRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  statNum: { fontFamily: MONO, fontSize: 9, marginRight: 12 },

  // label/value line rows
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  lineLbl: { fontSize: 10, color: NAVY3 },
  lineVal: { fontFamily: MONO, fontSize: 10, color: NAVY2 },
  lineValStrong: { fontFamily: SERIF, fontWeight: "bold", fontSize: 11, color: NAVY },

  divider: { borderTopWidth: 1, borderColor: BORDER, marginTop: 8, paddingTop: 8 },
  small: { fontSize: 8, color: NAVY3, lineHeight: 1.5, marginTop: 4 },
  body13: { fontSize: 10, color: NAVY2, lineHeight: 1.5, marginTop: 2 },

  // treatment A · reason panel (solid)
  reasonPanel: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    borderRadius: 6,
    padding: 12,
    marginTop: 6,
  },
  reasonText: { fontSize: 9, color: NAVY3, lineHeight: 1.5 },

  // finance streams
  financeCaption: { fontSize: 9, color: NAVY3, lineHeight: 1.5, marginBottom: 8, maxWidth: 470 },
  streamRow: { flexDirection: "row", gap: 10 },
  stream: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 8, padding: 12 },
  streamTitle: { fontSize: 9, color: NAVY3, fontWeight: "bold", letterSpacing: 0.6, marginBottom: 4 },
  streamHeadline: { fontFamily: SERIF, fontWeight: "bold", fontSize: 17, color: NAVY, marginTop: 2 },
  memo: { fontFamily: MONO, fontSize: 8, color: NAVY3, lineHeight: 1.5, marginTop: 4 },
  financeFoot: { fontSize: 8, color: NAVY3, marginTop: 8, lineHeight: 1.5 },

  // rate bar
  barTrack: {
    height: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    overflow: "hidden",
    marginTop: 6,
  },
  barFill: { height: "100%", backgroundColor: GOLD },

  // performance tiers
  perfBlock: { marginTop: 8 },
  seniorBig: { fontFamily: SERIF, fontWeight: "bold", fontSize: 18, color: NAVY },

  // footer
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 40,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  footerText: { fontSize: 7.5, color: NAVY3, letterSpacing: 0.4 },
  goldEm: { color: GOLD, fontWeight: "bold" },

  // director drill-down tables + attention rows (#309)
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: BORDER,
    paddingVertical: 3,
  },
  trHead: { backgroundColor: BG, borderBottomWidth: 1, borderColor: GOLD_SOFT },
  thText: { fontSize: 7.5, fontWeight: "bold", color: NAVY3, letterSpacing: 0.4, paddingHorizontal: 3 },
  tdText: { fontFamily: MONO, fontSize: 9, color: NAVY2, paddingHorizontal: 3 },
  tdLabel: { fontSize: 9, color: NAVY, paddingHorizontal: 3 },
  attnRow: { flexDirection: "row", alignItems: "flex-start", gap: 7, paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 2 },
  attnLabel: { fontSize: 10, fontWeight: "bold", color: NAVY },
  attnValue: { fontSize: 9, color: NAVY3, marginTop: 1 },
});

// ActionItem severity → hex (greyscale-safe order terra → warn → navy-2, as on the dashboard).
const ATTN_HEX: Record<ActionItem["dot"], string> = { terra: TERRA, warn: WARN, "navy-2": NAVY2 };

/* ─────────────────────────── small presentational bits ─────────────────────────── */

function SectionHead({ lead, accent, meta }: { lead: string; accent: string; meta?: string }) {
  return (
    <View style={s.secHeadRow}>
      <Text style={s.secTitle}>
        {lead} <Text style={s.secGold}>{accent}</Text>.
      </Text>
      {meta ? <Text style={s.secMeta}>{meta}</Text> : null}
    </View>
  );
}

/** Treatment A — a solid-border NOT_CAPTURED / NOT_APPLICABLE reason. No number. */
function ReasonPanel({ children }: { children: string }) {
  return (
    <View style={s.reasonPanel}>
      <Text style={s.reasonText}>{children}</Text>
    </View>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.line}>
      <Text style={s.lineLbl}>{label}</Text>
      <Text style={strong ? s.lineValStrong : s.lineVal}>{value}</Text>
    </View>
  );
}

/**
 * Trend chip — encodes ONLY the sign of an EXPOSED delta (never a threshold health verdict). `delta ==
 * null` → no chip. Greyscale-safe by the SIGN (+/−) and word, not hue alone. The direction TRIANGLE
 * (▲/▼) the dashboard uses is dropped in print: the standard-14 PDF fonts carry no such glyph, so the
 * sign is the robust encoder until the real brand TTFs are registered (fonts.ts follow-up).
 * ponytail: ASCII sign, restore ▲/▼ when Font.register lands.
 */
function TrendChip({
  delta,
  unit = "",
  context = "",
  flatLabel = "level",
}: {
  delta: number | null;
  unit?: string;
  context?: string;
  flatLabel?: string;
}) {
  if (delta == null) return null;
  const n = Math.round(delta * 10) / 10;
  if (n === 0) return <Text style={[s.chip, s.chipFlat]}>{`— ${flatLabel}`}</Text>;
  const up = n > 0;
  const suffix = [unit, context].filter(Boolean).join(" ");
  const core = up ? `+${n}` : `-${Math.abs(n)}`;
  return <Text style={[s.chip, up ? s.chipUp : s.chipDown]}>{suffix ? `${core} ${suffix}` : core}</Text>;
}

function GenderBar({ female, male }: { female: number; male: number }) {
  return (
    <View style={s.segTrack}>
      {female > 0 ? <View style={{ flexGrow: female, backgroundColor: FEMALE_HEX }} /> : null}
      {male > 0 ? <View style={{ flexGrow: male, backgroundColor: MALE_HEX }} /> : null}
    </View>
  );
}

function StatusBar({ totals }: { totals: AttendanceStatusTotals }) {
  const total = totals.present + totals.late + totals.excused + totals.medical + totals.absent;
  return (
    <View>
      <View style={s.segTrack}>
        {total > 0
          ? ATTENDANCE_STATUS_ORDER.map((st) => {
              const count = totals[st.toLowerCase() as keyof AttendanceStatusTotals];
              if (count === 0) return null;
              return <View key={st} style={{ flexGrow: count, backgroundColor: STATUS_HEX[st] }} />;
            })
          : null}
      </View>
      <View style={s.readoutRow}>
        {ATTENDANCE_STATUS_ORDER.map((st) => {
          const count = totals[st.toLowerCase() as keyof AttendanceStatusTotals];
          return (
            <Text key={st} style={[s.statNum, { color: STATUS_HEX[st] }]}>
              {ATTENDANCE_STATUS_META[st].letter} {num(count)}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

function RateBar({ value }: { value: number }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <View style={s.barTrack}>
      <View style={[s.barFill, { width: `${w}%` }]} />
    </View>
  );
}

/* ─────────────────────────── sections ─────────────────────────── */

function EnrolmentSection({ arm }: { arm: RollupArm<EnrolmentArm> }) {
  const v = armView(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead lead="Enrolment" accent="at a glance" meta={v.shown ? v.data.levelSummary : undefined} />
      {!v.shown ? (
        <ReasonPanel>{v.reason}</ReasonPanel>
      ) : (
        <EnrolmentBody d={v.data} />
      )}
    </View>
  );
}

function EnrolmentBody({ d }: { d: EnrolmentArm }) {
  return (
    <View>
      <View style={s.headRow}>
        <Text style={s.headline}>{num(d.roll)}</Text>
        {d.netChange == null ? (
          <Text style={s.caption}>point-in-time roll</Text>
        ) : (
          <TrendChip delta={d.netChange} context="this term" flatLabel="no change" />
        )}
      </View>

      <GenderBar female={d.gender.female} male={d.gender.male} />
      <Text style={[s.statNum, { color: NAVY3, marginTop: 4 }]}>
        {d.gender.female}F · {d.gender.male}M
      </Text>

      <View style={{ marginTop: 8 }}>
        <Line label="Active classes" value={num(d.activeClasses)} />
        <Line label="Avg class size" value={num(d.avgClassSize)} />
        <Line label="Teaching staff" value={num(d.teachingStaff)} />
        <Line
          label="Student : teacher"
          value={d.studentTeacherRatio == null ? "—" : `${d.studentTeacherRatio}:1`}
        />
      </View>

      <View style={s.divider}>
        <Text style={s.eyebrow}>INTAKE THIS TERM</Text>
        <Text style={s.body13}>
          {dash(d.admissionsThisTerm)} new ({dash(d.intakeFemale)}F · {dash(d.intakeMale)}M)
        </Text>
        <Text style={s.body13}>
          Lifetime exits: {num(d.withdrew)} withdrew · {num(d.transferred)} transferred ·{" "}
          {num(d.graduated)} graduated ({num(d.lifetimeExits)} total)
        </Text>
        <Text style={s.small}>
          Withdrawals, transfers and graduations are current lifetime totals — per-term exit dating
          arrives when status history is tracked.
        </Text>
      </View>
    </View>
  );
}

function AttendanceSection({ arm }: { arm: RollupArm<AttendanceArm> }) {
  const v = armView(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead
        lead="Attendance"
        accent="this term"
        meta={v.shown ? `${num(v.data.totalMarked)} marks recorded` : undefined}
      />
      {!v.shown ? (
        <ReasonPanel>{v.reason}</ReasonPanel>
      ) : (
        <View>
          <View style={s.headRow}>
            <Text style={s.headline}>{pct(v.data.schoolRate)}</Text>
            {v.data.schoolDelta == null ? (
              <Text style={s.caption}>(present + late) ÷ all marks</Text>
            ) : (
              <TrendChip delta={v.data.schoolDelta} unit="pts" context="vs last term" flatLabel="level" />
            )}
          </View>
          <StatusBar totals={v.data.statusTotals} />
        </View>
      )}
    </View>
  );
}

function FinanceSection({ arm }: { arm: RollupArm<NetPositionFinanceArm> }) {
  const v = armView(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead lead="Financial" accent="position" />
      <Text style={s.financeCaption}>
        Three separate records shown side by side. Fee collections and the school&apos;s books are kept
        as separate ledgers and are not combined into a single profit; payroll is a current monthly
        figure.
      </Text>
      {!v.shown ? (
        <ReasonPanel>{v.reason}</ReasonPanel>
      ) : (
        <>
          <View style={s.streamRow}>
            <FeeStream arm={v.data.fees} />
            <BooksStream arm={v.data.books} />
            <PayrollStream arm={v.data.payroll} />
          </View>
          <Text style={s.financeFoot}>
            Figures are management records for governance oversight, not an audited financial statement.
          </Text>
        </>
      )}
    </View>
  );
}

function FeeStream({ arm }: { arm: RollupArm<FeeCollectionsArm> }) {
  const v = armView(arm);
  return (
    <View style={s.stream}>
      <Text style={s.streamTitle}>Fee collections</Text>
      {!v.shown ? (
        <Text style={s.reasonText}>{v.reason}</Text>
      ) : (
        <>
          <Text style={s.streamHeadline}>{ghs(v.data.collected)}</Text>
          <Text style={s.caption}>collected · this term</Text>
          <RateBar value={v.data.collectionRate} />
          <Text style={s.memo}>{ghs(v.data.outstanding)} outstanding</Text>
        </>
      )}
    </View>
  );
}

function BooksStream({ arm }: { arm: RollupArm<BooksFinanceLine> }) {
  const v = armView(arm);
  return (
    <View style={s.stream}>
      <Text style={s.streamTitle}>Books (this term)</Text>
      {!v.shown ? (
        <Text style={s.reasonText}>{v.reason}</Text>
      ) : (
        <View style={{ marginTop: 2 }}>
          <Line label="Income" value={ghs(v.data.income)} />
          <Line label="Expense" value={ghs(v.data.expense)} />
          <Line label="Net" value={ghs(v.data.net)} strong />
        </View>
      )}
    </View>
  );
}

function PayrollStream({ arm }: { arm: RollupArm<PayrollLine> }) {
  const v = armView(arm);
  return (
    <View style={s.stream}>
      <Text style={s.streamTitle}>Payroll</Text>
      {!v.shown ? (
        <Text style={s.reasonText}>{v.reason}</Text>
      ) : (
        <>
          <Text style={s.streamHeadline}>{ghs(v.data.schoolPaidMonthlyTotal)}</Text>
          <Text style={s.caption}>school-paid · gross · monthly</Text>
          <Text style={s.memo}>
            GES-paid (memo, not added): {ghs(v.data.gesPaidMonthlyMemo)}
            {v.data.allowanceMonthlyMemo > 0
              ? `\nAllowance (memo, not added): ${ghs(v.data.allowanceMonthlyMemo)}`
              : ""}
          </Text>
        </>
      )}
    </View>
  );
}

function PerformanceSection({ performance }: { performance: PerformanceArm }) {
  const basic = tierView(performance.basic);
  const senior = tierView(performance.senior);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead lead="Academic" accent="performance" meta="cross-tier · this term" />

      {basic.kind !== "omit" ? (
        <View style={s.perfBlock}>
          <Text style={s.eyebrow}>BASIC · GRADEBOOK</Text>
          {basic.kind === "captured" ? (
            <View style={s.headRow}>
              <Text style={s.headline}>{pct(basic.data.overallAverage)}</Text>
              {basic.data.passRate != null ? (
                <Text style={[s.caption, { color: NAVY2, fontWeight: "bold" }]}>
                  {basic.data.passRate}% pass rate
                </Text>
              ) : null}
              <Text style={s.caption}>
                {basic.data.gradedClasses} {basic.data.gradedClasses === 1 ? "class" : "classes"} graded
              </Text>
              <TrendChip delta={basic.data.overallDelta} unit="pts" context="vs last term" />
            </View>
          ) : (
            <ReasonPanel>{basic.reason}</ReasonPanel>
          )}
        </View>
      ) : null}

      {senior.kind !== "omit" ? (
        <View style={s.perfBlock}>
          <Text style={s.eyebrow}>SENIOR · STPSHS READINESS</Text>
          {senior.kind === "captured" ? (
            <SeniorLine d={senior.data} />
          ) : (
            <ReasonPanel>{senior.reason}</ReasonPanel>
          )}
        </View>
      ) : null}
    </View>
  );
}

function SeniorLine({ d }: { d: SeniorReadinessSummary }) {
  return (
    <Text style={s.body13}>
      <Text style={s.seniorBig}>{d.subjectsReady}</Text> of {d.subjectsTotal} subjects ready ·{" "}
      <Text style={{ color: GOLD, fontWeight: "bold" }}>{d.subjectsPartial} partial</Text> ·{" "}
      <Text style={{ color: TERRA, fontWeight: "bold" }}>{d.subjectsAtRisk} at risk</Text>
    </Text>
  );
}

/**
 * GOV-6 · terminal exam results. Each exam is honest-absence-gated on its OWN via `tierView`: a
 * NOT_APPLICABLE exam (a BASIC school's WASSCE / a SENIOR school's BECE) is OMITTED (omit-not-fake),
 * NOT_CAPTURED shows a reason panel (no number), CAPTURED shows the derived figure. A fabricated number
 * for a not-captured exam is a compile error — `.data` is reachable only through the `captured` branch.
 */
function TerminalSection({ arm }: { arm: TerminalResultsArm }) {
  const bece = tierView(arm.bece);
  const wassce = tierView(arm.wassce);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead lead="Terminal" accent="results" />
      {bece.kind !== "omit" ? (
        <View style={s.perfBlock}>
          <Text style={s.eyebrow}>BECE</Text>
          {bece.kind === "captured" ? (
            <TerminalLine d={bece.data} />
          ) : (
            <ReasonPanel>{bece.reason}</ReasonPanel>
          )}
        </View>
      ) : null}
      {wassce.kind !== "omit" ? (
        <View style={s.perfBlock}>
          <Text style={s.eyebrow}>WASSCE</Text>
          {wassce.kind === "captured" ? (
            <TerminalLine d={wassce.data} />
          ) : (
            <ReasonPanel>{wassce.reason}</ReasonPanel>
          )}
        </View>
      ) : null}
    </View>
  );
}

function TerminalLine({ d }: { d: TerminalResultSummary }) {
  return (
    <View style={s.headRow}>
      <Text style={s.headline}>{d.passRate}%</Text>
      <Text style={s.caption}>
        pass · {d.year} · {num(d.passedCount)}/{num(d.totalCandidates)} passed
      </Text>
      <Text style={[s.caption, { fontFamily: MONO }]}>
        {d.female.passed}/{d.female.candidates}F · {d.male.passed}/{d.male.candidates}M
      </Text>
    </View>
  );
}

/**
 * GOV-7 · the LATEST facilities snapshot, projected to the board figures via `armView` — the SAME
 * compile-fence as every other section: `.data` is reachable only through the CAPTURED branch, so a
 * fabricated number for a not-captured tile is a compile error, and the census-only fields (caterer /
 * furniture / staff FTE) are structurally absent from `InfrastructureSummary` and can never print here.
 */
function InfrastructureSection({ arm }: { arm: RollupArm<InfrastructureSummary> }) {
  const v = armView(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead
        lead="Infrastructure"
        accent="& facilities"
        meta={v.shown ? `${v.data.capturedFor.periodLabel} · ${v.data.capturedFor.academicYear}` : undefined}
      />
      {!v.shown ? <ReasonPanel>{v.reason}</ReasonPanel> : <InfrastructureBody d={v.data} />}
    </View>
  );
}

function InfrastructureBody({ d }: { d: InfrastructureSummary }) {
  const yn = (b: boolean) => (b ? "Yes" : "No");
  const dn = (n: number | null) => (n == null ? "—" : num(n));
  return (
    <View>
      <View style={s.headRow}>
        <Text style={s.headline}>{d.classrooms.pctGood == null ? "—" : `${d.classrooms.pctGood}%`}</Text>
        <Text style={s.caption}>
          classrooms sound · {d.classrooms.good}/{d.classrooms.total} good ·{" "}
          {d.classrooms.needingRepair} need repair
        </Text>
      </View>
      <View style={{ marginTop: 8 }}>
        <Line label="Water" value={d.utilities.waterSource} />
        <Line label="Electricity" value={d.utilities.electricitySource} />
        <Line
          label="Sanitation"
          value={`${d.utilities.latrineType} · ${num(d.utilities.latrinesTotal)} latrines`}
        />
        <Line label="Handwashing" value={yn(d.utilities.handwashing)} />
        <Line
          label="ICT lab"
          value={d.ict.hasLab ? `Yes · ${dn(d.ict.working)}/${dn(d.ict.computers)} working` : "No"}
        />
        <Line label="Internet" value={yn(d.ict.internet)} />
        <Line label="Library" value={d.library.has ? `Yes · ${dn(d.library.bookCount)} books` : "No"} />
        <Line
          label="Feeding"
          value={
            d.feeding.gsfpParticipating
              ? `GSFP · ${dn(d.feeding.pupilsFedDaily)} fed daily`
              : d.feeding.hasKitchen
                ? "Own kitchen"
                : "None"
          }
        />
        {d.textbooks.availability ? <Line label="Textbooks" value={d.textbooks.availability} /> : null}
      </View>
    </View>
  );
}

/* ─────────────────────────── director drill-downs (#309) ─────────────────────────── */

/** A flex-weighted table row. First cell left-aligns (the label), the rest right-align (figures). */
function Tr({ cells, widths, head }: { cells: string[]; widths: number[]; head?: boolean }) {
  return (
    <View style={[s.tr, head ? s.trHead : {}]}>
      {cells.map((c, i) => (
        <Text
          key={i}
          style={[
            head ? s.thText : i === 0 ? s.tdLabel : s.tdText,
            { flexGrow: widths[i], flexBasis: 0, textAlign: i === 0 ? "left" : "right" },
          ]}
        >
          {c}
        </Text>
      ))}
    </View>
  );
}

/** "Needs your attention" — the conditional action rows (omit-not-fake: no rows ⇒ the section is absent). */
function AttentionSection({ items }: { items: ActionItem[] }) {
  if (items.length === 0) return null;
  return (
    <View style={s.section} wrap={false}>
      <SectionHead lead="Needs your" accent="attention" meta={`${items.length} ${items.length === 1 ? "item" : "items"}`} />
      {items.map((it) => (
        <View key={it.key} style={s.attnRow}>
          <View style={[s.dot, { backgroundColor: ATTN_HEX[it.dot] }]} />
          <View style={{ flex: 1 }}>
            <Text style={s.attnLabel}>{it.label}</Text>
            <Text style={s.attnValue}>{it.value}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Performance by year-group — the aggregate LevelPerformance rows (omitted when nothing is graded). */
function YearGroupPerformanceSection({ perf }: { perf: LevelPerformance }) {
  if (!perf.hasAnyScores || perf.rows.length === 0) return null;
  return (
    <View style={s.section} wrap={false}>
      <SectionHead lead="Performance" accent="by year-group" meta="aggregate · this term" />
      <Tr head widths={[3, 1.4, 1.2, 1.2, 2]} cells={["Year group", "Average", "Grade", "Pass", "Graded"]} />
      {perf.rows.map((r) => (
        <Tr
          key={r.level}
          widths={[3, 1.4, 1.2, 1.2, 2]}
          cells={[
            r.level,
            pct(r.average),
            r.grade ?? "—",
            pct(r.passRate),
            `${num(r.studentsGraded)} · ${r.classesGraded}/${r.classes} cls`,
          ]}
        />
      ))}
    </View>
  );
}

/** Attendance by year-group — the lossless P/L/E/M/A fold (omitted when the attendance arm isn't captured). */
function AttendanceByLevelSection({ rows }: { rows: InsightsAttendanceLevelRow[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={s.section} wrap={false}>
      <SectionHead lead="Attendance" accent="by year-group" meta="(present + late) ÷ marks" />
      <Tr head widths={[3, 1.3, 1, 1, 1, 1, 1]} cells={["Year group", "Rate", "P", "L", "E", "M", "A"]} />
      {rows.map((r) => (
        <Tr
          key={r.level}
          widths={[3, 1.3, 1, 1, 1, 1, 1]}
          cells={[
            r.level,
            pct(r.rate),
            num(r.counts.present),
            num(r.counts.late),
            num(r.counts.excused),
            num(r.counts.medical),
            num(r.counts.absent),
          ]}
        />
      ))}
    </View>
  );
}

/** Census · age & gender — roll + gender split + the GES "enrolment by approved age" (under/on/over). */
function CensusSection({ census }: { census: CensusEnrolment }) {
  return (
    <View style={s.section} wrap={false}>
      <SectionHead lead="Census" accent="age & gender" meta={`as of ${census.censusDate}`} />
      <View style={s.headRow}>
        <Text style={s.headline}>{num(census.roll)}</Text>
        <Text style={s.caption}>
          on roll · {census.gender.female}F · {census.gender.male}M
        </Text>
      </View>
      <GenderBar female={census.gender.female} male={census.gender.male} />
      {census.approvedAge.length > 0 ? (
        <View style={{ marginTop: 10 }}>
          <Text style={s.eyebrow}>ENROLMENT BY APPROVED AGE · VS GES OFFICIAL AGE</Text>
          <Tr head widths={[3, 1.4, 1.2, 1.2, 1.2]} cells={["Year group", "Official age", "Under", "On-age", "Over"]} />
          {census.approvedAge.map((a) => (
            <Tr
              key={a.level}
              widths={[3, 1.4, 1.2, 1.2, 1.2]}
              cells={[a.level, String(a.officialAge), num(a.under), num(a.on), num(a.over)]}
            />
          ))}
        </View>
      ) : null}
      {census.dobUnknown > 0 ? (
        <Text style={s.small}>
          {num(census.dobUnknown)} pupils have no date of birth on file — excluded from the age bands.
        </Text>
      ) : null}
    </View>
  );
}

/* ─────────────────────────── document ─────────────────────────── */

export function BoardPackDocument({ data }: { data: BoardPackData }) {
  const { rollup, attention, levelPerf, attendanceByLevel, census, meta } = data;
  return (
    <Document
      title={`Board & Governance Overview — ${meta.schoolName}`}
      author="Omnischools"
      subject={`Board pack · ${meta.termLabel}`}
    >
      <Page size="A4" style={s.page}>
        <View style={s.strip} fixed />

        {/* Cover band */}
        <View style={s.cover}>
          <View style={s.mark}>
            <Text style={s.markText}>{meta.schoolInitials}</Text>
          </View>
          <Text style={s.coverSchool}>{meta.schoolName}</Text>
          <Text style={s.coverTitle}>
            Board &amp; Governance <Text style={s.secGold}>Overview</Text>
          </Text>
          <Text style={s.coverTerm}>{meta.termLabel}</Text>
          <Text style={s.coverGen}>Generated {meta.generatedAtLabel}</Text>
          <Text style={s.coverFraming}>
            Read-only governance snapshot · aggregate figures only, no per-student detail.
          </Text>
        </View>

        {/* Sections — board order, then the director drill-downs (#309) */}
        <View style={s.body}>
          <AttentionSection items={attention} />
          <EnrolmentSection arm={rollup.enrolment} />
          <AttendanceSection arm={rollup.attendance} />
          <FinanceSection arm={rollup.netPositionFinance} />
          <PerformanceSection performance={rollup.performance} />

          <TerminalSection arm={rollup.terminalResults} />

          <InfrastructureSection arm={rollup.infrastructure} />

          {/* Director drill-downs — aggregate detail the /insights + synced /board surfaces show. */}
          <YearGroupPerformanceSection perf={levelPerf} />
          <AttendanceByLevelSection rows={attendanceByLevel} />
          <CensusSection census={census} />
        </View>

        {/* Fixed footer + pagination */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Prepared on <Text style={s.goldEm}>Omnischools</Text> · the school management platform
          </Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) =>
              `${meta.schoolName} · Board pack · ${pageNumber}/${totalPages}`
            }
            fixed
          />
        </View>
      </Page>
    </Document>
  );
}
