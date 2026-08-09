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
 * GOV-9 · the ANNUAL GES census PDF (A4 portrait) — the print-and-sign statutory return. Presentational only:
 * fed the FROZEN `auto_snapshot` ARMS + `hand_fill` VERBATIM (R427), it branches on each `arm.coverage` via
 * the `census-parts` seam — a numeric render for a NONE/NOT_APPLICABLE section is a COMPILE ERROR (GOV9-10),
 * an un-entered HAND section prints a hatched blank (GOV9-06), and the signature/stamp are WET — an empty
 * signature line + typed name label, never a forged glyph (R426/GOV9-12). Core PDF fonts stand in for brand.
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

  // hatched "complete by hand" block (honest empty — never a 0)
  hatch: { borderWidth: 1, borderStyle: "dashed", borderColor: GOLD_SOFT, backgroundColor: BG, borderRadius: 5, padding: 9, marginTop: 4 },
  hatchLbl: { fontSize: 8, color: WARN, fontWeight: "bold", letterSpacing: 0.6, marginBottom: 2 },
  hatchText: { fontSize: 8.5, color: NAVY3, lineHeight: 1.5 },

  // grid table (enrolment / SEN)
  tRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: BORDER },
  tHead: { backgroundColor: BG },
  tCell: { paddingVertical: 3, paddingHorizontal: 5, fontSize: 8.5, color: NAVY2 },
  tCellHead: { fontSize: 7.5, color: NAVY3, fontWeight: "bold", letterSpacing: 0.4 },
  tNum: { fontFamily: MONO, textAlign: "right" },

  small: { fontSize: 7.5, color: NAVY3, lineHeight: 1.5, marginTop: 3 },

  // declaration
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
/** Honest empty — a hatched "complete by hand" block carrying the reader's reason. NEVER a 0 (R422/GOV9-06). */
function Hatch({ reason }: { reason: string }) {
  return (
    <View style={s.hatch}>
      <Text style={s.hatchLbl}>TO BE COMPLETED BY HAND</Text>
      <Text style={s.hatchText}>{reason}</Text>
    </View>
  );
}

/* ── sections ── */
function Identification({ snap }: { snap: CensusSnapshot }) {
  const id = snap.identification;
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="1" title="School identification" />
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

function Enrolment({ arm }: { arm: CensusSnapshot["sections"]["enrolment"] }) {
  const v = armView<CensusEnrolment>(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="2" title="Enrolment by class & sex" meta={v.shown ? `${num(v.data.roll)} on roll` : undefined} />
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

function AgeDistribution({ arm }: { arm: CensusSnapshot["sections"]["ageDistribution"] }) {
  const v = armView<CensusAgeSummary>(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="3" title="Age distribution" />
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

function SpecialNeeds({ arm, hand }: { arm: CensusSnapshot["sections"]["specialNeeds"]; hand: CensusHandFill["specialNeeds"] }) {
  const v = armView<CensusSpecialNeeds>(arm);
  // Adopted → the frozen de-id aggregate; not-adopted → the hand-fill counts (if entered) else hatched.
  const grid: Partial<Record<string, { male: number; female: number }>> | null = v.shown
    ? v.data.byCategory
    : (hand ?? null);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="4" title="Special-needs enrolment (§5)" meta={v.shown ? "auto · from the SEN register" : undefined} />
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

function Movement({ arm, hand }: { arm: CensusSnapshot["sections"]["movement"]; hand: CensusHandFill["movementExits"] }) {
  const v = armView<CensusMovement>(arm);
  const h = handView(hand);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="5" title="Movement — admissions & exits" />
      {v.shown ? (
        <Line label="Admissions this period" value={`${dash(v.data.admissionsThisPeriod)} · ${dash(v.data.intakeMale)}B · ${dash(v.data.intakeFemale)}G`} />
      ) : (
        <Hatch reason={v.reason} />
      )}
      {h.filled ? (
        <View style={{ marginTop: 4 }}>
          <Line label="Withdrawals (year)" value={num(h.data.withdrawals)} />
          <Line label="Transfers in / out" value={`${num(h.data.transfersIn)} / ${num(h.data.transfersOut)}`} />
        </View>
      ) : (
        <Hatch reason="Full-year withdrawals and transfers by reason are hand-filled (in-app movement is admissions-only)." />
      )}
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

function Staff({ snap, hand }: { snap: CensusSnapshot; hand: CensusHandFill["qualifications"] }) {
  const ptr = armView<CensusPtr>(snap.sections.ptr);
  const sal = armView<CensusSalaryStatus>(snap.sections.salaryStatus);
  const h = handView(hand);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="6" title="Staff, ratio & salary" />
      <StaffGroup arm={snap.sections.teachingStaff} label="Teaching staff" />
      <StaffGroup arm={snap.sections.nonTeachingStaff} label="Non-teaching staff" />
      <Line label="Pupil–teacher ratio" value={ptr.shown && ptr.data.ratio != null ? `1 : ${ptr.data.ratio}` : "—"} />
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
    </View>
  );
}

function Attendance({ arm }: { arm: CensusSnapshot["sections"]["attendance"] }) {
  const v = armView<CensusAttendance>(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="7" title="Attendance" />
      {v.shown ? (
        <Line label="School attendance rate" value={`${pct(v.data.schoolRate)} · ${num(v.data.totalMarked)} marks`} />
      ) : (
        <Hatch reason={v.reason} />
      )}
    </View>
  );
}

function Terminal({ arm }: { arm: CensusSnapshot["sections"]["terminalResults"] }) {
  const v = armView<CensusTerminal>(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="8" title="Terminal results (BECE / WASSCE)" />
      {v.shown ? (
        <View>
          {v.data.bece ? <Line label={`BECE ${v.data.bece.year}`} value={`${v.data.bece.passRate}% · ${num(v.data.bece.passedCount)}/${num(v.data.bece.totalCandidates)}`} /> : null}
          {v.data.wassce ? <Line label={`WASSCE ${v.data.wassce.year}`} value={`${v.data.wassce.passRate}% · ${num(v.data.wassce.passedCount)}/${num(v.data.wassce.totalCandidates)}`} /> : null}
          {!v.data.bece && !v.data.wassce ? <Text style={s.small}>No terminal results captured.</Text> : null}
        </View>
      ) : v.shown === false && arm.coverage === "NOT_APPLICABLE" ? (
        <Text style={s.small}>{v.reason}</Text>
      ) : (
        <Hatch reason={v.reason} />
      )}
    </View>
  );
}

function Performance({ arm }: { arm: CensusSnapshot["sections"]["academicPerformance"] }) {
  const v = armView<CensusPerformance>(arm);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="9" title="Academic performance" />
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

function Infrastructure({ arm }: { arm: CensusSnapshot["sections"]["infrastructure"] }) {
  const v = armView<FacilitiesSnapshotRow>(arm);
  const yn = (b: boolean) => (b ? "Yes" : "No");
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="10" title="Infrastructure & facilities" />
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

function Repetition({ hand }: { hand: CensusHandFill["repetition"] }) {
  const h = handView(hand);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="11" title="Repetition (repeaters)" />
      {h.filled ? (
        <Line label="Repeaters (B / G)" value={`${num(h.data.male)} / ${num(h.data.female)}`} strong />
      ) : (
        <Hatch reason="Repeaters by class and sex are hand-filled (promotion history is not tracked in Omnischools)." />
      )}
    </View>
  );
}

function Feeding({ hand }: { hand: CensusHandFill["feeding"] }) {
  const h = handView(hand);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="12" title="School feeding (GSFP)" />
      {h.filled ? (
        <Line label="GSFP participation" value={`${h.data.participates ? "Participating" : "Not participating"}${h.data.pupilsFed != null ? ` · ${num(h.data.pupilsFed)} fed daily` : ""}${h.data.caterer ? ` · ${h.data.caterer}` : ""}`} />
      ) : (
        <Hatch reason="School-feeding participation is hand-filled (no feeding-register integration)." />
      )}
    </View>
  );
}

function Textbooks({ hand }: { hand: CensusHandFill["textbooks"] }) {
  const h = handView(hand);
  return (
    <View style={s.section} wrap={false}>
      <SectionHead n="13" title="Textbooks" />
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
  return (
    <View style={s.section} break>
      <Text style={s.declTitle}>Declaration</Text>
      <Text style={s.declText}>
        I, the undersigned headteacher of {id.schoolName || "________________"}, GES School ID{" "}
        {id.gesCode || "____________"}, certify that the information contained in this annual census for the
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
  return (
    <Document title={`Annual GES Census — ${id.schoolName}`} author="Omnischools" subject={`Annual census · ${snap.academicYear}`}>
      <Page size="A4" style={s.page}>
        <View style={s.strip} fixed />

        <View style={s.cover}>
          <View style={s.mark}>
            <Text style={s.markText}>{meta.schoolInitials}</Text>
          </View>
          <Text style={s.coverKicker}>GHANA EDUCATION SERVICE · ANNUAL SCHOOL CENSUS</Text>
          <Text style={s.coverSchool}>{id.schoolName || "—"}</Text>
          <Text style={s.coverTitle}>Annual census return · {snap.academicYear}</Text>
          <Text style={s.coverMeta}>GES ID {id.gesCode || "—"} · census date {snap.censusDate}</Text>
          <Text style={s.coverGen}>Generated {meta.generatedAtLabel}</Text>
          <Text style={s.statusPill}>{meta.status === "COMPLETED" ? "COMPLETED — OFFICIAL FILING" : "DRAFT — FOR COMPLETION BY HAND"}</Text>
        </View>

        <View style={s.body}>
          <Identification snap={snap} />
          <Enrolment arm={snap.sections.enrolment} />
          <AgeDistribution arm={snap.sections.ageDistribution} />
          <SpecialNeeds arm={snap.sections.specialNeeds} hand={hf.specialNeeds} />
          <Movement arm={snap.sections.movement} hand={hf.movementExits} />
          <Staff snap={snap} hand={hf.qualifications} />
          <Attendance arm={snap.sections.attendance} />
          <Terminal arm={snap.sections.terminalResults} />
          <Performance arm={snap.sections.academicPerformance} />
          <Infrastructure arm={snap.sections.infrastructure} />
          <Repetition hand={hf.repetition} />
          <Feeding hand={hf.feeding} />
          <Textbooks hand={hf.textbooks} />
          <Declaration snap={snap} meta={meta} />
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Prepared on <Text style={s.goldEm}>Omnischools</Text> · print-and-sign GES census
          </Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `${id.schoolName} · Annual census · ${pageNumber}/${totalPages}`} fixed />
        </View>
      </Page>
    </Document>
  );
}
