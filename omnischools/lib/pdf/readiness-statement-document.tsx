import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { SERIF, SANS, MONO } from "./fonts";

/**
 * Printable WASSCE readiness statement PDF (SHS module 4.3 / INCR-17). Re-rendered ON DEMAND from the
 * FROZEN `readiness_statements` snapshot — the values arrive pre-formatted from the loader, so this
 * component does no data access. ACADEMIC BLOCK ONLY: the projected aggregate, its best-3 construction,
 * the Mock 1 → Mock 2 trajectory, and the parent acknowledgement. INCR-17b adds the UNIVERSITY TARGET
 * block, rendered from the statement's FROZEN `target_universities_json` (AC20) — never the live board,
 * so a later cut-off/target edit leaves an issued PDF byte-identical. Mirrors the #136 receipt trio.
 * No new dependency: same @react-pdf/renderer primitives as the academic block.
 */

const NAVY = "#1A2B47";
const NAVY2 = "#2D3F5C";
const NAVY3 = "#5C6675";
const GOLD = "#C8975B";
const GOLD_SOFT = "#E8D4B8";
const GOLD_BG = "#F5EBDC";
const BG = "#FAF7F2";
const GREEN = "#2F6B47";
const GREEN_BG = "#E5F0EB";
const BORDER = "#E5DFD3";

export type ReadinessSubjectLine = {
  name: string;
  typeLabel: string; // "Core" | "Elective" | "Alternative"
  grade: string; // "A1"
  pointsLabel: string; // "3 pts"
  counted: boolean;
};

/** One frozen university target, pre-formatted by the loader from `target_universities_json`. */
export type ReadinessTargetLine = {
  name: string; // "KNUST · Biochemistry"
  programmeLine: string; // "B.Sc. · Kumasi"
  tierLabel: string; // "Target" | "Comfortable" | "Match" | "Stretch" | "Safety"
  isPrimary: boolean;
  cutOffLabel: string; // "11 (2025)" — the reference year always renders
  marginLabel: string; // "Margin · 1 inside"
  prerequisiteLabel: string;
};

export type ReadinessStatementData = {
  school: { name: string; initials: string };
  candidate: { fullName: string; indexNumber: string; programmeLabel: string };
  generatedAtLabel: string;
  superseded: boolean;
  projectedAggregate: number | null;
  projectedBand: string;
  mock1Aggregate: number | null;
  mock2Aggregate: number;
  subjects: ReadinessSubjectLine[];
  universityTargets: ReadinessTargetLine[]; // frozen at generation; `[]` when none were tagged
  parentAck: {
    acknowledgedAtLabel: string;
    methodLabel: string;
    phone: string | null;
    concerns: string | null;
  } | null;
};

const s = StyleSheet.create({
  page: { backgroundColor: "#FFFFFF", fontFamily: SANS, fontSize: 10, color: NAVY, paddingBottom: 40 },
  strip: { height: 6, backgroundColor: GOLD },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  schoolRow: { flexDirection: "row", gap: 10 },
  mark: { width: 40, height: 40, backgroundColor: NAVY, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  markText: { fontFamily: SERIF, fontWeight: "bold", fontSize: 15, color: GOLD },
  schoolName: { fontFamily: SERIF, fontWeight: "bold", fontSize: 14, color: NAVY, marginBottom: 2 },
  metaLine: { fontSize: 8.5, color: NAVY3, lineHeight: 1.5 },
  anchor: { alignItems: "flex-end" },
  docType: { fontSize: 8, color: GOLD, fontWeight: "bold", letterSpacing: 1, marginBottom: 3 },
  issued: { fontSize: 8.5, color: NAVY3 },

  candBar: {
    flexDirection: "row",
    paddingHorizontal: 40,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    borderStyle: "dashed",
  },
  cell: { flex: 1 },
  lbl: { fontSize: 7.5, color: GOLD, fontWeight: "bold", letterSpacing: 1, marginBottom: 2 },
  lblDark: { fontSize: 7.5, color: NAVY3, fontWeight: "bold", letterSpacing: 1, marginBottom: 2 },
  val: { fontFamily: SERIF, fontWeight: "bold", fontSize: 12, color: NAVY, lineHeight: 1.3 },
  mono: { fontFamily: MONO, fontSize: 10, color: NAVY, fontWeight: "bold" },

  body: { paddingHorizontal: 40, paddingTop: 16 },

  hero: {
    backgroundColor: GREEN_BG,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroLbl: { fontSize: 8, color: GREEN, fontWeight: "bold", letterSpacing: 1.4, marginBottom: 4 },
  heroAgg: { fontFamily: SERIF, fontWeight: "bold", fontSize: 40, color: GREEN, lineHeight: 1 },
  heroBand: { fontSize: 10, color: NAVY2, marginTop: 4 },
  heroMeta: { fontSize: 8.5, color: NAVY3, textAlign: "right", maxWidth: 180, lineHeight: 1.5 },

  sectionTitle: {
    fontSize: 8,
    color: NAVY3,
    fontWeight: "bold",
    letterSpacing: 1.4,
    marginBottom: 8,
    marginTop: 4,
  },

  traj: { flexDirection: "row", gap: 10, marginBottom: 16 },
  trajCell: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 6, padding: 10 },
  trajStage: { fontSize: 7.5, color: NAVY3, fontWeight: "bold", letterSpacing: 0.8, marginBottom: 4 },
  trajAgg: { fontFamily: SERIF, fontWeight: "bold", fontSize: 22, color: NAVY },
  trajUnit: { fontSize: 8, color: NAVY3 },

  poolTitle: { fontSize: 9, color: NAVY, fontWeight: "bold", marginTop: 8, marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    borderStyle: "dashed",
  },
  rowDropped: { opacity: 0.45 },
  subjName: { fontFamily: SERIF, fontSize: 10.5, color: NAVY, flex: 1 },
  subjGrade: { fontFamily: MONO, fontSize: 9.5, color: NAVY2, width: 34 },
  subjPts: { fontFamily: MONO, fontSize: 9.5, color: NAVY2, width: 50, textAlign: "right" },
  subjTag: { fontSize: 7.5, fontWeight: "bold", letterSpacing: 0.5, width: 90, textAlign: "right" },
  tagCounted: { color: GREEN },
  tagDropped: { color: NAVY3 },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 2,
    borderTopColor: NAVY,
    paddingTop: 8,
    marginTop: 6,
  },
  totalLbl: { fontSize: 8.5, color: NAVY3, fontWeight: "bold", letterSpacing: 1 },
  totalVal: { fontFamily: SERIF, fontWeight: "bold", fontSize: 20, color: GREEN },

  // --- university block (INCR-17b) — rendered from the FROZEN target_universities_json ---
  uniRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    borderStyle: "dashed",
  },
  uniPrimary: { backgroundColor: GOLD_BG, borderLeftWidth: 3, borderLeftColor: GOLD, paddingLeft: 6 },
  uniMain: { flex: 1 },
  uniName: { fontFamily: SERIF, fontSize: 10.5, color: NAVY },
  uniSub: { fontSize: 8, color: NAVY3, marginTop: 1 },
  uniTier: { fontSize: 8, fontWeight: "bold", letterSpacing: 0.5, width: 78, textAlign: "right", color: NAVY2 },
  uniCut: { fontFamily: MONO, fontSize: 9, color: NAVY2, width: 66, textAlign: "right" },
  uniMargin: { fontSize: 8, color: NAVY3, width: 96, textAlign: "right" },
  uniEmpty: { fontSize: 9, color: NAVY3, fontStyle: "italic", paddingVertical: 6 },

  ackBox: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: GOLD_SOFT,
    backgroundColor: GOLD_BG,
    borderRadius: 8,
    padding: 14,
  },
  ackTitle: { fontFamily: SERIF, fontWeight: "bold", fontSize: 11, color: NAVY, marginBottom: 4 },
  ackMeta: { fontSize: 9, color: NAVY2, lineHeight: 1.5 },
  ackPending: { fontSize: 9, color: NAVY3, fontStyle: "italic" },

  note: {
    marginTop: 14,
    padding: 12,
    backgroundColor: BG,
    borderRadius: 6,
    fontSize: 8.5,
    color: NAVY3,
    lineHeight: 1.5,
  },
  bold: { color: NAVY, fontWeight: "bold" },

  platform: {
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
  platformText: { fontSize: 7.5, color: NAVY3, letterSpacing: 0.4 },
  goldEm: { color: GOLD, fontWeight: "bold" },

  supersededTag: {
    marginTop: 8,
    alignSelf: "flex-start",
    fontSize: 8,
    fontWeight: "bold",
    color: NAVY3,
    letterSpacing: 1,
  },
});

function PoolBlock({ title, subjects }: { title: string; subjects: ReadinessSubjectLine[] }) {
  return (
    <View>
      <Text style={s.poolTitle}>{title}</Text>
      {subjects.map((li, i) => (
        <View key={i} style={[s.row, ...(li.counted ? [] : [s.rowDropped])]}>
          <Text style={s.subjName}>{li.name}</Text>
          <Text style={s.subjGrade}>{li.grade}</Text>
          <Text style={s.subjPts}>{li.pointsLabel}</Text>
          <Text style={[s.subjTag, li.counted ? s.tagCounted : s.tagDropped]}>
            {li.counted ? "COUNTED" : "DROPPED"}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function ReadinessStatementDocument({ data }: { data: ReadinessStatementData }) {
  const cores = data.subjects.filter((x) => x.typeLabel === "Core");
  const electives = data.subjects.filter((x) => x.typeLabel !== "Core");
  const aggText = data.projectedAggregate != null ? String(data.projectedAggregate) : "—";

  return (
    <Document
      title={`WASSCE readiness statement — ${data.candidate.fullName}`}
      author="Omnischools"
      subject={`Projected WASSCE aggregate for ${data.candidate.fullName}`}
    >
      <Page size="A4" style={s.page}>
        <View style={s.strip} />

        {/* header */}
        <View style={s.header}>
          <View style={s.schoolRow}>
            <View style={s.mark}>
              <Text style={s.markText}>{data.school.initials}</Text>
            </View>
            <View>
              <Text style={s.schoolName}>{data.school.name}</Text>
              <Text style={s.metaLine}>WASSCE readiness statement</Text>
            </View>
          </View>
          <View style={s.anchor}>
            <Text style={s.docType}>PROJECTED AGGREGATE</Text>
            <Text style={s.issued}>Generated {data.generatedAtLabel}</Text>
          </View>
        </View>

        {/* candidate bar */}
        <View style={s.candBar}>
          <View style={s.cell}>
            <Text style={s.lbl}>CANDIDATE</Text>
            <Text style={s.val}>{data.candidate.fullName}</Text>
          </View>
          <View style={s.cell}>
            <Text style={s.lblDark}>INDEX NUMBER</Text>
            <Text style={s.mono}>{data.candidate.indexNumber}</Text>
          </View>
          <View style={s.cell}>
            <Text style={s.lblDark}>PROGRAMME</Text>
            <Text style={s.val}>{data.candidate.programmeLabel}</Text>
          </View>
        </View>

        <View style={s.body}>
          {/* hero aggregate */}
          <View style={s.hero}>
            <View>
              <Text style={s.heroLbl}>PROJECTED AGGREGATE</Text>
              <Text style={s.heroAgg}>{aggText}</Text>
              <Text style={s.heroBand}>{data.projectedBand} · lower is better (6 best · 54 worst)</Text>
            </View>
            <Text style={s.heroMeta}>
              Projected from the {`Mock 2`} predictor sitting. Not a WAEC result — WASSCE scores release
              in mid-August.
            </Text>
          </View>

          {/* trajectory */}
          <Text style={s.sectionTitle}>MOCK 1 → MOCK 2 → PROJECTED</Text>
          <View style={s.traj}>
            <View style={s.trajCell}>
              <Text style={s.trajStage}>MOCK 1</Text>
              <Text style={s.trajAgg}>{data.mock1Aggregate ?? "—"}</Text>
              <Text style={s.trajUnit}>aggregate</Text>
            </View>
            <View style={s.trajCell}>
              <Text style={s.trajStage}>MOCK 2 · PREDICTOR</Text>
              <Text style={s.trajAgg}>{data.mock2Aggregate}</Text>
              <Text style={s.trajUnit}>aggregate</Text>
            </View>
            <View style={[s.trajCell, { borderColor: GOLD_SOFT, backgroundColor: GOLD_BG }]}>
              <Text style={s.trajStage}>WASSCE PROJECTED</Text>
              <Text style={s.trajAgg}>{aggText}</Text>
              <Text style={s.trajUnit}>holding</Text>
            </View>
          </View>

          {/* best-3 construction */}
          <Text style={s.sectionTitle}>AGGREGATE CONSTRUCTION · BEST 3 CORES + BEST 3 ELECTIVES</Text>
          <PoolBlock title="Cores" subjects={cores} />
          <PoolBlock title="Electives" subjects={electives} />
          <View style={s.totalRow}>
            <Text style={s.totalLbl}>AGGREGATE · BEST 3 CORES + BEST 3 ELECTIVES</Text>
            <Text style={s.totalVal}>{aggText}</Text>
          </View>

          {/* university targets — FROZEN at generation, not the live board (AC15/AC20) */}
          <Text style={s.sectionTitle}>UNIVERSITY TARGETS · MATCHED AGAINST THE PUBLISHED CUT-OFF</Text>
          {data.universityTargets.length === 0 ? (
            <Text style={s.uniEmpty}>
              No target programmes were tagged when this statement was generated.
            </Text>
          ) : (
            data.universityTargets.map((t, i) => (
              <View key={i} style={[s.uniRow, ...(t.isPrimary ? [s.uniPrimary] : [])]}>
                <View style={s.uniMain}>
                  <Text style={s.uniName}>{t.name}</Text>
                  <Text style={s.uniSub}>
                    {t.programmeLine} · {t.prerequisiteLabel}
                  </Text>
                </View>
                <Text style={s.uniTier}>{t.tierLabel.toUpperCase()}</Text>
                <Text style={s.uniCut}>{t.cutOffLabel}</Text>
                <Text style={s.uniMargin}>{t.marginLabel}</Text>
              </View>
            ))
          )}
          <Text style={[s.uniSub, { marginTop: 6 }]}>
            Cut-offs are a published SNAPSHOT of the year shown beside each figure, not live admissions
            data. Universities adjust cut-offs after results if the applicant pool changes — these figures
            are indicative, not guarantees.
          </Text>

          {/* parent acknowledgement */}
          <View style={s.ackBox}>
            {data.parentAck ? (
              <>
                <Text style={s.ackTitle}>
                  Parent acknowledged this readiness statement on {data.parentAck.acknowledgedAtLabel}
                </Text>
                <Text style={s.ackMeta}>
                  {[data.parentAck.methodLabel, data.parentAck.phone].filter(Boolean).join(" · ")}
                  {data.parentAck.concerns ? ` · concern noted: ${data.parentAck.concerns}` : ""}
                </Text>
              </>
            ) : (
              <>
                <Text style={s.ackTitle}>Awaiting parent acknowledgement</Text>
                <Text style={s.ackPending}>
                  This statement has been generated and shared. The parent acknowledgement is captured by
                  the school on the parent&apos;s behalf.
                </Text>
              </>
            )}
          </View>

          <Text style={s.note}>
            This is a <Text style={s.bold}>projection</Text>, computed from the school&apos;s predictor
            mock using the WAEC best-3 rule (best 3 cores + best 3 electives, A1=1 … F9=9). It is{" "}
            <Text style={s.bold}>advisory, not a WAEC result</Text>, and does not adjust for any missed
            or exempted live paper — the projected aggregate holds on the last valid mock signal until
            WAEC releases scores.
          </Text>

          {data.superseded ? (
            <Text style={s.supersededTag}>SUPERSEDED — a newer statement has replaced this one</Text>
          ) : null}
        </View>

        <View style={s.platform} fixed>
          <Text style={s.platformText}>
            Issued on <Text style={s.goldEm}>Omnischools</Text> · the school management platform
          </Text>
          <Text style={s.platformText}>{data.candidate.indexNumber}</Text>
        </View>
      </Page>
    </Document>
  );
}
