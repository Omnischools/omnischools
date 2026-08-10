import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { SERIF, SANS, MONO } from "./fonts";
import { armView, handView, num, dash, pct } from "./census-parts";
import { SEN_CATEGORY_ORDER, SEN_CATEGORY_LABEL } from "@/lib/sen/vocab";
import type { CensusSnapshot } from "@/lib/reports/census/schema";
import type { CensusHandFill } from "@/lib/reports/census/hand-fill-schema";
import type { CensusEnrolment } from "@/lib/reports/census-enrolment-data";
import type { CensusStaffGroup, CensusSalaryStatus } from "@/lib/reports/census/census-staff-data";
import type { FacilitiesSnapshotRow } from "@/lib/reports/facilities-data";
import type { CensusSpecialNeeds } from "@/lib/reports/census/sen-data";
import type {
  CensusMovement,
  CensusPtr,
  CensusAttendance,
  CensusTerminal,
  CensusPerformance,
  CensusAgeSummary,
} from "@/lib/reports/census/schema";

/**
 * GOV-9 · the GES census PDF (A4 portrait) — the print-and-sign statutory return. Presentational only: fed the
 * FROZEN `auto_snapshot` ARMS + `hand_fill` VERBATIM (R427), it branches on each `arm.coverage` via the
 * `census-parts` seam — a numeric render for a NONE/NOT_APPLICABLE section is a COMPILE ERROR (GOV9-10), an
 * un-entered HAND section prints a hatched blank (GOV9-06), and the signature/stamp are WET (R426).
 *
 * GOV-9b · cadence-aware. An ANNUAL run renders all 13 sections; a MID_YEAR run renders ONLY the mid-year set
 * (identification / enrolment / age / movement-admissions / staff+PTR / attendance) — the annual-only sections
 * (SEN §5, repetition, qualifications, salary, terminal, performance, infrastructure, feeding, textbooks) are
 * OMITTED (they belong to the annual return; showing them hatched on a mid-year return would be noise). Mirrors
 * the `view.ts` cadence gating (annual-only rows are `cadences: ANNUAL`).
 */

// design tokens (hex; @react-pdf can't use CSS vars)
const NAVY = "#1A2B47";
const NAVY2 = "#2D3F5C";
const NAVY3 = "#5C6675";
const GOLD = "#C8975B";
const GOLD_SOFT = "#E8D4B8";
const GOLD_BG = "#F5EBDC";
const BG = "#FAF7F2";
const WARN = "#C58A2E";
const BORDER = "#E5DFD3";

export type CensusPdfData = {
  /** The FROZEN snapshot arms + hand-fill, verbatim — the document branches on each section (R427). */
  snapshot: CensusSnapshot;
  handFill: CensusHandFill;
  meta: {
    schoolInitials: string;
    cadence: "MID_YEAR" | "ANNUAL"; // GOV-9b — gates the annual-only sections + the cover/declaration copy
    status: string; // "DRAFT" | "COMPLETED"
    generatedAtLabel: string;
    headteacherName: string | null; // profile → signer → null (R426: blank line, never fabricated)
  };
};

const s = StyleSheet.create({
  page: { backgroundColor: "#FFFFFF", fontFamily: SANS, fontSize: 9.5, color: NAVY, paddingTop: 10, paddingBottom: 40 },
  strip: { position: "absolute", top: 0, left: 0, right: 0, height: 6, backgroundColor: GOLD },
  cover: { backgroundColor: GOLD_BG, borderBottomWidth: 1, borderColor: GOLD_SOFT, alignItems: "center", paddingHorizontal: 40, paddingTop: 18, paddingBottom: 16 },
  mark: { width: 44, height: 44, backgroundColor: NAVY, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  markText: { fontFamily: SERIF, fontWeight: "bold", fontSize: 17, color: GOLD },
  coverKicker: { fontSize: 8, color: NAVY3, fontWeight: "bold", letterSpacing: 1.5, marginBottom: 4 },
  coverSchool: { fontFamily: SERIF, fontWeight: "bold", fontSize: 20, color: NAVY, textAlign: "center" },
  coverTitle: { fontFamily: SERIF, fontSize: 12, color: NAVY, marginTop: 4, textAlign: "center" },
  coverMeta: { fontFamily: MONO, fontSize: 9, color: NAVY2, marginTop: 7 },
  coverGen: { fontSize: 8, color: NAVY3, marginTop: 3 },
  statusPill: { marginTop: 8, fontFamily: MONO, fontSize: 8, fontWeight: "bold", letterSpacing: 1, paddingVertical: 3, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: GOLD_SOFT, color: NAVY2 },

  body: { paddingHorizontal: 40, paddingTop: 12 },
  section: { marginBottom: 13 },
  secHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 5, borderBottomWidth: 1, borderColor: BORDER, paddingBottom: 3 },
  secNum: { fontFamily: SERIF, fontStyle: "italic", fontSize: 13, color: GOLD, marginRight: 6 },
  secTitle: { fontFamily: SERIF, fontSize: 13, color: NAVY },
  secMeta: { fontSize: 8, color: NAVY3 },

  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  lineLbl: { fontSize: 9, color: NAVY3 },
  lineVal: { fontFamily: MONO, fontSize: 9, color: NAVY2 },
  lineValStrong: { fontFamily: SERIF, fontWeight: "bold", fontSize: 10, color: NAVY },

  hatch: { borderWidth: 1, borderStyle: "dashed", borderColor: GOLD_SOFT, backgroundColor: BG, borderRadius: 5, padding: 9, marginTop: 4 },
  hatchLbl: { fontSize: 8, color: WARN, fontWeight: "bold", letterSpacing: 0.6, marginBottom: 2 },
  hatchText: { fontSize: 8.5, color: NAVY3, lineHeight: 1.5 },

  tRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: BORDER },
  tHead: { backgroundColor: BG },
  tCell: { paddingVertical: 3, paddingHorizontal: 5, fontSize: 8.5, color: NAVY2 },
  tCellHead: { fontSize: 7.5, color: NAVY3, fontWeight: "bold", letterSpacing: 0.4 },
  tNum: { fontFamily: MONO, textAlign: "right" },

  small: { fontSize: 7.5, color: NAVY3, lineHeight: 1.5, marginTop: 3 },

  declTitle: { fontFamily: SERIF, fontSize: 14, color: NAVY, marginBottom: 6 },
  declText: { fontSize: 9.5, color: NAVY2, lineHeight: 1.6, marginBottom: 12 },
  sigRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 24 },
  sigBlock: { width: "46%" },
  sigLine: { borderTopWidth: 1, borderColor: NAVY3, marginTop: 26, paddingTop: 3 },
  sigLbl: { fontSize: 8, color: NAVY3 },
  sigName: { fontFamily: SERIF, fontSize: 10, color: NAVY, marginTop: 1 },
  stampBox: { marginTop: 22, width: 130, height: 74, borderWidth: 1, borderStyle: "dashed", borderColor: NAVY3, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  stampLbl: { fontSize: 8, color: NAVY3 },
  instr: { marginTop: 22, borderTopWidth: 1, borderColor: BORDER, paddingTop: 8 },

  footer: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 40, paddingVertical: 10, borderTopWidth: 1, borderTopColor: BORDER },
  footerText: { fontSize: 7, color: NAVY3, letterSpacing: 0.3 },
  goldEm: { color: GOLD, fontWeight: "bold" },
});

/* ── helpers ── */
function SectionHead({ n, title, meta }: { n: string; title: string; meta?: string }) {
  return (
    <View style={s.secHeadRow}>
      <Text>
        <Text style={s.secNum}>{n}</Text>
        <Text style={s.secTitle}>{title}</Text>
      </Text>
      {meta ? <Text style={s.secMeta}>{meta}</Text> : null}
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
function Hatch({ reason }: { reason: string }) {
  return (
    <View style={s.hatch}>
      <Text style={s.hatchLbl}>TO BE COMPLETED BY HAND</Text>
      <Text style={s.hatchText}>{reason}</Text>
    </View>
  );
}

/* ── sections ── */
function Identification({ snap, n }: { snap: CensusSnapshot; n: string }) {
  const id = snap.identification;
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title="School identification" />
      <Line label="School name" value={id.schoolName || "—"} strong />
      <Line label="GES school ID" value={id.gesCode || "—"} />
      <Line label="School type" value={id.schoolType || "—"} />
      <Line label="District" value={id.district ?? "—"} />
      <Line label="Region" value={id.region ?? "—"} />
      <Line label="Ownership" value={id.ownership ?? "—"} />
      <Line label="Academic year" value={snap.academicYear} />
      <Line label="Census date" value={snap.censusDate} />
    </View>
  );
}

function Enrolment({ arm, n }: { arm: CensusSnapshot["sections"]["enrolment"]; n: string }) {
  const v = armView<CensusEnrolment>(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title="Enrolment by class & sex" meta={v.shown ? `${num(v.data.roll)} on roll` : undefined} />
      {!v.shown ? (
        <Hatch reason={v.reason} />
      ) : (
        <View>
          <View style={[s.tRow, s.tHead]}>
            <Text style={[s.tCell, s.tCellHead, { flex: 3 }]}>CLASS</Text>
            <Text style={[s.tCell, s.tCellHead, s.tNum, { flex: 1 }]}>BOYS</Text>
            <Text style={[s.tCell, s.tCellHead, s.tNum, { flex: 1 }]}>GIRLS</Text>
            <Text style={[s.tCell, s.tCellHead, s.tNum, { flex: 1 }]}>TOTAL</Text>
          </View>
          {v.data.byClass.map((c) => (
            <View style={s.tRow} key={c.classId}>
              <Text style={[s.tCell, { flex: 3 }]}>{c.name}</Text>
              <Text style={[s.tCell, s.tNum, { flex: 1 }]}>{num(c.male)}</Text>
              <Text style={[s.tCell, s.tNum, { flex: 1 }]}>{num(c.female)}</Text>
              <Text style={[s.tCell, s.tNum, { flex: 1 }]}>{num(c.total)}</Text>
            </View>
          ))}
          <View style={s.tRow}>
            <Text style={[s.tCell, { flex: 3, fontFamily: SERIF, color: NAVY }]}>Total</Text>
            <Text style={[s.tCell, s.tNum, { flex: 1, color: NAVY }]}>{num(v.data.gender.male)}</Text>
            <Text style={[s.tCell, s.tNum, { flex: 1, color: NAVY }]}>{num(v.data.gender.female)}</Text>
            <Text style={[s.tCell, s.tNum, { flex: 1, color: NAVY }]}>{num(v.data.roll)}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function AgeDistribution({ arm, n }: { arm: CensusSnapshot["sections"]["ageDistribution"]; n: string }) {
  const v = armView<CensusAgeSummary>(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title="Age distribution" />
      {!v.shown ? (
        <Hatch reason={v.reason} />
      ) : (
        <Text style={s.small}>
          {num(v.data.roll - v.data.dobUnknown)} of {num(v.data.roll)} students have a recorded date of
          birth ({num(v.data.levelsWithAge)} levels aged). {v.data.dobUnknown > 0 ? `${num(v.data.dobUnknown)} without a DOB are left blank — never a guessed age.` : "Ages computed from DOB."}
          {"\n"}The age-by-class grid is completed by hand from this roll.
        </Text>
      )}
    </View>
  );
}

function SpecialNeeds({ arm, hand, n }: { arm: CensusSnapshot["sections"]["specialNeeds"]; hand: CensusHandFill["specialNeeds"]; n: string }) {
  const v = armView<CensusSpecialNeeds>(arm);
  const grid: Partial<Record<string, { male: number; female: number }>> | null = v.shown
    ? v.data.byCategory
    : (hand ?? null);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title="Special-needs enrolment (§5)" meta={v.shown ? "auto · from the SEN register" : undefined} />
      {grid ? (
        <View>
          <View style={[s.tRow, s.tHead]}>
            <Text style={[s.tCell, s.tCellHead, { flex: 3 }]}>CATEGORY</Text>
            <Text style={[s.tCell, s.tCellHead, s.tNum, { flex: 1 }]}>BOYS</Text>
            <Text style={[s.tCell, s.tCellHead, s.tNum, { flex: 1 }]}>GIRLS</Text>
          </View>
          {SEN_CATEGORY_ORDER.map((c) => {
            const cell = grid[c] ?? { male: 0, female: 0 };
            return (
              <View style={s.tRow} key={c}>
                <Text style={[s.tCell, { flex: 3 }]}>{SEN_CATEGORY_LABEL[c]}</Text>
                <Text style={[s.tCell, s.tNum, { flex: 1 }]}>{num(cell.male)}</Text>
                <Text style={[s.tCell, s.tNum, { flex: 1 }]}>{num(cell.female)}</Text>
              </View>
            );
          })}
          <Text style={s.small}>De-identified counts only — no student names are reported. {v.shown ? "" : "Entered by hand (SEN register not adopted)."}</Text>
        </View>
      ) : (
        <Hatch reason={v.shown ? "" : v.reason} />
      )}
    </View>
  );
}

function Movement({ arm, hand, n, annual }: { arm: CensusSnapshot["sections"]["movement"]; hand: CensusHandFill["movementExits"]; n: string; annual: boolean }) {
  const v = armView<CensusMovement>(arm);
  const h = handView(hand);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title={annual ? "Movement — admissions & exits" : "Admissions this period"} />
      {v.shown ? (
        <Line label="Admissions this period" value={`${dash(v.data.admissionsThisPeriod)} · ${dash(v.data.intakeMale)}B · ${dash(v.data.intakeFemale)}G`} />
      ) : (
        <Hatch reason={v.reason} />
      )}
      {annual ? (
        h.filled ? (
          <View style={{ marginTop: 4 }}>
            <Line label="Withdrawals (year)" value={num(h.data.withdrawals)} />
            <Line label="Transfers in / out" value={`${num(h.data.transfersIn)} / ${num(h.data.transfersOut)}`} />
          </View>
        ) : (
          <Hatch reason="Full-year withdrawals and transfers by reason are hand-filled (in-app movement is admissions-only)." />
        )
      ) : null}
    </View>
  );
}

function StaffGroup({ arm, label }: { arm: CensusSnapshot["sections"]["teachingStaff"]; label: string }) {
  const v = armView<CensusStaffGroup>(arm);
  return v.shown ? (
    <Line label={label} value={`${num(v.data.total)} · ${num(v.data.male)}M · ${num(v.data.female)}F${v.data.unknown > 0 ? ` · ${num(v.data.unknown)} unspecified` : ""}`} />
  ) : (
    <Line label={label} value="—" />
  );
}

function Staff({ snap, hand, n, annual }: { snap: CensusSnapshot; hand: CensusHandFill["qualifications"]; n: string; annual: boolean }) {
  const ptr = armView<CensusPtr>(snap.sections.ptr);
  const sal = armView<CensusSalaryStatus>(snap.sections.salaryStatus);
  const h = handView(hand);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title={annual ? "Staff, ratio & salary" : "Staff & pupil–teacher ratio"} />
      <StaffGroup arm={snap.sections.teachingStaff} label="Teaching staff" />
      <StaffGroup arm={snap.sections.nonTeachingStaff} label="Non-teaching staff" />
      <Line label="Pupil–teacher ratio" value={ptr.shown && ptr.data.ratio != null ? `1 : ${ptr.data.ratio}` : "—"} />
      {annual ? (
        <>
          <Line
            label="Salary status"
            value={
              snap.sections.salaryStatus.coverage === "NOT_APPLICABLE"
                ? "No payroll in Omnischools"
                : sal.shown
                  ? `${num(sal.data.schoolPaid)} school · ${num(sal.data.gesPaid)} GES · ${num(sal.data.allowance)} allowance`
                  : "—"
            }
          />
          {h.filled ? (
            <View style={{ marginTop: 4 }}>
              <Line label="Trained (M / F)" value={`${num(h.data.trainedMale)} / ${num(h.data.trainedFemale)}`} />
              <Line label="Untrained (M / F)" value={`${num(h.data.untrainedMale)} / ${num(h.data.untrainedFemale)}`} />
            </View>
          ) : (
            <Hatch reason="Trained / untrained split is hand-filled (no training flag on staff profiles)." />
          )}
        </>
      ) : null}
    </View>
  );
}

function Attendance({ arm, n }: { arm: CensusSnapshot["sections"]["attendance"]; n: string }) {
  const v = armView<CensusAttendance>(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title="Attendance" />
      {v.shown ? (
        <Line label="School attendance rate" value={`${pct(v.data.schoolRate)} · ${num(v.data.totalMarked)} marks`} />
      ) : (
        <Hatch reason={v.reason} />
      )}
    </View>
  );
}

function Terminal({ arm, n }: { arm: CensusSnapshot["sections"]["terminalResults"]; n: string }) {
  const v = armView<CensusTerminal>(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title="Terminal results (BECE / WASSCE)" />
      {v.shown ? (
        <View>
          {v.data.bece ? <Line label={`BECE ${v.data.bece.year}`} value={`${v.data.bece.passRate}% · ${num(v.data.bece.passedCount)}/${num(v.data.bece.totalCandidates)}`} /> : null}
          {v.data.wassce ? <Line label={`WASSCE ${v.data.wassce.year}`} value={`${v.data.wassce.passRate}% · ${num(v.data.wassce.passedCount)}/${num(v.data.wassce.totalCandidates)}`} /> : null}
          {!v.data.bece && !v.data.wassce ? <Text style={s.small}>No terminal results captured.</Text> : null}
        </View>
      ) : arm.coverage === "NOT_APPLICABLE" ? (
        <Text style={s.small}>{v.reason}</Text>
      ) : (
        <Hatch reason={v.reason} />
      )}
    </View>
  );
}

function Performance({ arm, n }: { arm: CensusSnapshot["sections"]["academicPerformance"]; n: string }) {
  const v = armView<CensusPerformance>(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title="Academic performance" />
      {v.shown ? (
        <View>
          {v.data.basic ? <Line label="Basic gradebook average" value={`${pct(v.data.basic.overallAverage)} · ${pct(v.data.basic.passRate)} pass · ${num(v.data.basic.gradedClasses)} classes`} /> : null}
          {v.data.seniorSubjectsReady != null ? <Line label="Senior subjects ready (STPSHS)" value={num(v.data.seniorSubjectsReady)} /> : null}
        </View>
      ) : (
        <Hatch reason={v.reason} />
      )}
    </View>
  );
}

function Infrastructure({ arm, n }: { arm: CensusSnapshot["sections"]["infrastructure"]; n: string }) {
  const v = armView<FacilitiesSnapshotRow>(arm);
  const yn = (b: boolean) => (b ? "Yes" : "No");
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title="Infrastructure & facilities" />
      {!v.shown ? (
        <Hatch reason={v.reason} />
      ) : (
        <View>
          <Line label="Classrooms" value={`${num(v.data.classroomsGood)}/${num(v.data.classroomsTotal)} good · ${num(v.data.classroomsRepair)} need repair`} />
          <Line label="Water · electricity" value={`${v.data.waterSource} · ${v.data.electricitySource}`} />
          <Line label="Latrines (B / G / staff)" value={`${num(v.data.latrinesBoys)} / ${num(v.data.latrinesGirls)} / ${num(v.data.latrinesStaff)}`} />
          <Line label="Library · ICT lab · kitchen" value={`${yn(v.data.hasLibrary)} · ${yn(v.data.hasIctLab)} · ${yn(v.data.hasKitchen)}`} />
        </View>
      )}
    </View>
  );
}

function Repetition({ hand, n }: { hand: CensusHandFill["repetition"]; n: string }) {
  const h = handView(hand);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title="Repetition (repeaters)" />
      {h.filled ? (
        <Line label="Repeaters (B / G)" value={`${num(h.data.male)} / ${num(h.data.female)}`} strong />
      ) : (
        <Hatch reason="Repeaters by class and sex are hand-filled (promotion history is not tracked in Omnischools)." />
      )}
    </View>
  );
}

function Feeding({ hand, n }: { hand: CensusHandFill["feeding"]; n: string }) {
  const h = handView(hand);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title="School feeding (GSFP)" />
      {h.filled ? (
        <Line label="GSFP participation" value={`${h.data.participates ? "Participating" : "Not participating"}${h.data.pupilsFed != null ? ` · ${num(h.data.pupilsFed)} fed daily` : ""}${h.data.caterer ? ` · ${h.data.caterer}` : ""}`} />
      ) : (
        <Hatch reason="School-feeding participation is hand-filled (no feeding-register integration)." />
      )}
    </View>
  );
}

function Textbooks({ hand, n }: { hand: CensusHandFill["textbooks"]; n: string }) {
  const h = handView(hand);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n={n} title="Textbooks" />
      {h.filled ? (
        <Line label="Textbook availability" value={`${h.data.adequate ? "Adequate" : "Inadequate"}${h.data.note ? ` · ${h.data.note}` : ""}`} />
      ) : (
        <Hatch reason="Textbook availability by subject and class is hand-filled from the stockroom." />
      )}
    </View>
  );
}

function Declaration({ snap, meta }: { snap: CensusSnapshot; meta: CensusPdfData["meta"] }) {
  const id = snap.identification;
  const cad = meta.cadence === "MID_YEAR" ? "mid-year" : "annual";
  return (
    <View style={s.section} break>
      <Text style={s.declTitle}>Declaration</Text>
      <Text style={s.declText}>
        I, the undersigned headteacher of {id.schoolName || "________________"}, GES School ID{" "}
        {id.gesCode || "____________"}, certify that the information contained in this {cad} census for the
        academic year {snap.academicYear} is, to the best of my knowledge, accurate and complete. I understand
        that auto-filled sections derived from Omnischools records and manually-completed sections filled in by
        hand are equally my responsibility. I confirm that this census has been prepared in accordance with the
        directives of the Ghana Education Service and that the school&apos;s records support every figure
        reported herein.
      </Text>

      <View style={s.sigRow}>
        <View style={s.sigBlock}>
          <View style={s.sigLine}>
            <Text style={s.sigLbl}>Headteacher signature</Text>
            <Text style={s.sigName}>{meta.headteacherName ?? " "}</Text>
          </View>
          <View style={{ marginTop: 18 }}>
            <View style={s.sigLine}>
              <Text style={s.sigLbl}>Date</Text>
            </View>
          </View>
        </View>
        <View style={s.sigBlock}>
          <View style={s.sigLine}>
            <Text style={s.sigLbl}>Received by — District Education Officer</Text>
          </View>
          <View style={s.stampBox}>
            <Text style={s.stampLbl}>School stamp</Text>
          </View>
        </View>
      </View>

      <View style={s.instr}>
        <Text style={s.small}>
          Filing: print this return, complete every hand-marked section in ink, sign and stamp above, then submit
          two copies to your District Education Office and retain a copy for five years. This is a print-and-sign
          return — Omnischools does not submit it electronically.
        </Text>
      </View>
    </View>
  );
}

/* ── document ── */
export function CensusDocument({ data }: { data: CensusPdfData }) {
  const { snapshot: snap, handFill: hf, meta } = data;
  const id = snap.identification;
  const annual = meta.cadence === "ANNUAL";
  const cadenceLabel = annual ? "Annual" : "Mid-year";
  return (
    <Document title={`${cadenceLabel} GES Census — ${id.schoolName}`} author="Omnischools" subject={`${cadenceLabel} census · ${snap.academicYear}`}>
      <Page size="A4" style={s.page}>
        <View style={s.strip} fixed />

        <View style={s.cover}>
          <View style={s.mark}>
            <Text style={s.markText}>{meta.schoolInitials}</Text>
          </View>
          <Text style={s.coverKicker}>GHANA EDUCATION SERVICE · {annual ? "ANNUAL" : "MID-YEAR"} SCHOOL CENSUS</Text>
          <Text style={s.coverSchool}>{id.schoolName || "—"}</Text>
          <Text style={s.coverTitle}>{cadenceLabel} census return · {snap.academicYear}</Text>
          <Text style={s.coverMeta}>GES ID {id.gesCode || "—"} · census date {snap.censusDate}</Text>
          <Text style={s.coverGen}>Generated {meta.generatedAtLabel}</Text>
          <Text style={s.statusPill}>{meta.status === "COMPLETED" ? "COMPLETED — OFFICIAL FILING" : "DRAFT — FOR COMPLETION BY HAND"}</Text>
        </View>

        <View style={s.body}>
          <Identification snap={snap} n="1" />
          <Enrolment arm={snap.sections.enrolment} n="2" />
          <AgeDistribution arm={snap.sections.ageDistribution} n="3" />
          {annual && <SpecialNeeds arm={snap.sections.specialNeeds} hand={hf.specialNeeds} n="4" />}
          <Movement arm={snap.sections.movement} hand={annual ? hf.movementExits : undefined} annual={annual} n={annual ? "5" : "4"} />
          <Staff snap={snap} hand={annual ? hf.qualifications : undefined} annual={annual} n={annual ? "6" : "5"} />
          <Attendance arm={snap.sections.attendance} n={annual ? "7" : "6"} />
          {annual && <Terminal arm={snap.sections.terminalResults} n="8" />}
          {annual && <Performance arm={snap.sections.academicPerformance} n="9" />}
          {annual && <Infrastructure arm={snap.sections.infrastructure} n="10" />}
          {annual && <Repetition hand={hf.repetition} n="11" />}
          {annual && <Feeding hand={hf.feeding} n="12" />}
          {annual && <Textbooks hand={hf.textbooks} n="13" />}
          <Declaration snap={snap} meta={meta} />
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Prepared on <Text style={s.goldEm}>Omnischools</Text> · print-and-sign GES census
          </Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `${id.schoolName} · ${cadenceLabel} census · ${pageNumber}/${totalPages}`} fixed />
        </View>
      </Page>
    </Document>
  );
}
