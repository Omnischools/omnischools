import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { SERIF, SANS, MONO } from "./fonts";

/**
 * Terminal report-card PDF (A4) — a faithful print rendering of the on-screen report card
 * at app/(app)/gradebook/report/[studentId]. Presentational only; the route pre-loads and
 * passes all values. Core PDF fonts (see ./fonts) stand in for the brand faces.
 */

const NAVY = "#1A2B47";
const NAVY3 = "#5C6675";
const GOLD = "#C8975B";
const GOLD_BG = "#F5EBDC";
const BG = "#FAF7F2";
const BORDER = "#E5DFD3";

const fmt0 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(0));
const fmt2 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));

export type ReportCardLine = {
  subject: string;
  classScore: number | null;
  examScore: number | null;
  total: number | null;
  grade: string | null;
};
export type ReportCardData = {
  school: { name: string; initials: string };
  title: string; // "Terminal Report"
  periodLabel: string; // "2025/26 · Term 1"
  student: { name: string; code: string; classLabel: string };
  lines: ReportCardLine[];
  overallTotal: number | null;
  overallGrade: string | null;
  remark?: string | null;
  generatedAt?: string | null; // preformatted date, or null
};

const s = StyleSheet.create({
  page: { backgroundColor: "#FFFFFF", fontFamily: SANS, fontSize: 10, color: NAVY, padding: 0 },
  strip: { height: 6, backgroundColor: GOLD },

  header: { alignItems: "center", paddingHorizontal: 40, paddingTop: 22, paddingBottom: 16 },
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
  schoolName: { fontFamily: SERIF, fontWeight: "bold", fontSize: 22, color: NAVY, textAlign: "center" },
  eyebrow: {
    fontSize: 8,
    color: GOLD,
    fontWeight: "bold",
    letterSpacing: 1.6,
    marginTop: 8,
  },
  periodLine: { fontSize: 10, color: NAVY3, marginTop: 3 },

  // student meta
  meta: {
    marginHorizontal: 40,
    marginBottom: 18,
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    backgroundColor: BG,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  metaCell: { width: "50%", paddingVertical: 3 },
  metaLbl: { fontSize: 8, color: NAVY3, fontWeight: "bold", letterSpacing: 0.6 },
  metaVal: { fontSize: 11, color: NAVY, marginTop: 1 },
  metaMono: { fontFamily: MONO, fontSize: 10, color: NAVY, marginTop: 1 },

  // table
  table: { marginHorizontal: 40 },
  thead: {
    flexDirection: "row",
    borderBottomWidth: 1.5,
    borderBottomColor: NAVY,
    paddingBottom: 6,
  },
  th: { fontSize: 8, color: NAVY3, fontWeight: "bold", letterSpacing: 0.8, textTransform: "uppercase" },
  trow: {
    flexDirection: "row",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    alignItems: "center",
  },
  colSubject: { flex: 1 },
  colNum: { width: 64, textAlign: "right" },
  colGrade: { width: 56, textAlign: "right" },
  tdSubject: { fontSize: 10.5, color: NAVY },
  tdNum: { fontSize: 10, color: "#2D3F5C" },
  tdTotal: { fontFamily: SERIF, fontWeight: "bold", fontSize: 10.5, color: NAVY },
  tdGrade: { fontFamily: SERIF, fontWeight: "bold", fontSize: 10.5, color: NAVY },
  emptyRow: { paddingVertical: 20, textAlign: "center", fontSize: 10, color: NAVY3 },

  // summary
  summary: {
    marginHorizontal: 40,
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 20,
  },
  remarkBox: { flex: 1 },
  remarkLbl: { fontSize: 8, color: NAVY3, fontWeight: "bold", letterSpacing: 0.6, marginBottom: 3 },
  remarkText: { fontSize: 10, color: "#2D3F5C", lineHeight: 1.5 },
  overallBox: {
    borderWidth: 1,
    borderColor: GOLD,
    backgroundColor: GOLD_BG,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: "flex-end",
    minWidth: 150,
  },
  overallLbl: { fontSize: 8, color: NAVY3, fontWeight: "bold", letterSpacing: 1 },
  overallRow: { flexDirection: "row", alignItems: "baseline", marginTop: 3 },
  overallTotal: { fontFamily: SERIF, fontWeight: "bold", fontSize: 26, color: NAVY },
  overallGrade: { fontFamily: SERIF, fontWeight: "bold", fontSize: 18, color: GOLD, marginLeft: 8 },

  // signatures
  signatures: {
    marginHorizontal: 40,
    marginTop: 40,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sigCol: { width: "42%" },
  sigLine: { borderBottomWidth: 1, borderBottomColor: NAVY, marginBottom: 4 },
  sigLbl: { fontSize: 8, color: NAVY3 },

  // footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 8,
  },
  footerText: { fontSize: 8, color: NAVY3, letterSpacing: 0.3 },
  goldEm: { color: GOLD, fontWeight: "bold" },
});

function MetaCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={s.metaCell}>
      <Text style={s.metaLbl}>{label}</Text>
      <Text style={mono ? s.metaMono : s.metaVal}>{value}</Text>
    </View>
  );
}

export function ReportCardDocument({ data }: { data: ReportCardData }) {
  return (
    <Document
      title={`${data.title} — ${data.student.name}`}
      author="Omnischools"
      subject={`${data.title} · ${data.periodLabel}`}
    >
      <Page size="A4" style={s.page}>
        <View style={s.strip} />

        {/* Header */}
        <View style={s.header}>
          <View style={s.mark}>
            <Text style={s.markText}>{data.school.initials}</Text>
          </View>
          <Text style={s.schoolName}>{data.school.name}</Text>
          <Text style={s.eyebrow}>{data.title.toUpperCase()}</Text>
          <Text style={s.periodLine}>{data.periodLabel}</Text>
        </View>

        {/* Student meta */}
        <View style={s.meta}>
          <MetaCell label="STUDENT" value={data.student.name} />
          <MetaCell label="STUDENT CODE" value={data.student.code} mono />
          <MetaCell label="CLASS" value={data.student.classLabel} />
        </View>

        {/* Scores table */}
        <View style={s.table}>
          <View style={s.thead}>
            <Text style={[s.th, s.colSubject]}>Subject</Text>
            <Text style={[s.th, s.colNum]}>Class</Text>
            <Text style={[s.th, s.colNum]}>Exam</Text>
            <Text style={[s.th, s.colNum]}>Total</Text>
            <Text style={[s.th, s.colGrade]}>Grade</Text>
          </View>
          {data.lines.length === 0 ? (
            <Text style={s.emptyRow}>No scores entered for this period.</Text>
          ) : (
            data.lines.map((l, i) => (
              <View key={i} style={s.trow}>
                <Text style={[s.tdSubject, s.colSubject]}>{l.subject}</Text>
                <Text style={[s.tdNum, s.colNum]}>{fmt0(l.classScore)}</Text>
                <Text style={[s.tdNum, s.colNum]}>{fmt0(l.examScore)}</Text>
                <Text style={[s.tdTotal, s.colNum]}>{fmt2(l.total)}</Text>
                <Text style={[s.tdGrade, s.colGrade]}>{l.grade ?? "—"}</Text>
              </View>
            ))
          )}
        </View>

        {/* Summary — remark + overall */}
        <View style={s.summary}>
          <View style={s.remarkBox}>
            {data.remark ? (
              <>
                <Text style={s.remarkLbl}>REMARK</Text>
                <Text style={s.remarkText}>{data.remark}</Text>
              </>
            ) : null}
          </View>
          <View style={s.overallBox}>
            <Text style={s.overallLbl}>OVERALL</Text>
            <View style={s.overallRow}>
              <Text style={s.overallTotal}>{fmt2(data.overallTotal)}</Text>
              {data.overallGrade ? (
                <Text style={s.overallGrade}>{data.overallGrade}</Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* Signatures */}
        <View style={s.signatures}>
          <View style={s.sigCol}>
            <View style={s.sigLine} />
            <Text style={s.sigLbl}>Class teacher</Text>
          </View>
          <View style={s.sigCol}>
            <View style={s.sigLine} />
            <Text style={s.sigLbl}>Headteacher</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            {data.generatedAt ? `Generated ${data.generatedAt}` : "Draft — not yet generated"}
          </Text>
          <Text style={s.footerText}>
            Issued on <Text style={s.goldEm}>Omnischools</Text>
          </Text>
        </View>
      </Page>
    </Document>
  );
}
