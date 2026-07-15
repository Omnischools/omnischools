import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { SERIF, SANS, MONO } from "./fonts";

/**
 * STPSHS printable score sheet (A4) — INCR-3 · Score Ledger Item 8. A 1:1 replication of
 * Surfaces/schoolup-shs-score-ledger.html §3 (the STPSHS Capture-Per-Subject mirror). Eight
 * columns, EXACT order, NO weighted-total column (STPSHS computes GPA itself). Presentational
 * only: every value arrives pre-formatted from lib/data/stpshs-sheet-data (de-scaled, capped,
 * REF resolved) so this component does zero data/locale/clamp work.
 *
 * Glyph gotcha (Lucy §7): `✓`/`☐` are outside the core-font WinAnsi set → tofu on
 * Times/Helvetica/Courier. The tick cell is a drawn bordered View; the tick header is blank.
 */

// --- design tokens (hex; @react-pdf can't use CSS vars) — mirror receipt/report-card ---
const NAVY = "#1A2B47";
const NAVY3 = "#5C6675";
const GOLD = "#C8975B";
const BG = "#FAF7F2";
const BORDER = "#E5DFD3";
const BORDER2 = "#D4CCBA";

export type StpshsSheetRow = {
  /** STPSHS Assessment Reference ID, or the literal "pending" when null (Q1). */
  ref: string;
  refPending: boolean;
  name: string;
  // Pre-formatted, de-scaled + capped category strings (Q2/Q5). "—" only if unfilled.
  asg: string;
  ms: string;
  es: string;
  proj: string;
  port: string;
};

export type StpshsSheetData = {
  school: { name: string; code: string };
  generatedDate: string; // "27 June 2026" (day month year), pre-formatted by the builder
  subject: string;
  yearLabel: string; // "Y2"
  semLabel: string; // "S2" (never "T2" — Kofi Q4: logic wins over the surface mock)
  rows: StpshsSheetRow[];
};

// Column widths for a 515pt A4 content band; name is the flexible column (Lucy §5.6).
const W_TICK = 22;
const W_REF = 92;
const W_SCORE = 30;

const s = StyleSheet.create({
  // paddingBottom reserves the fixed-footer band; the fixed header sits in normal flow.
  page: { backgroundColor: "#FFFFFF", fontFamily: SANS, fontSize: 10, color: NAVY, paddingBottom: 54 },
  strip: { height: 6, backgroundColor: GOLD },

  // header block
  head: { marginHorizontal: 40, marginTop: 18 },
  headRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: NAVY,
    paddingBottom: 14,
    marginBottom: 14,
  },
  // flex:1 so a long school name wraps within its column instead of colliding with the eyebrow.
  headLeft: { flex: 1, paddingRight: 16 },
  title: { fontFamily: SERIF, fontWeight: "bold", fontSize: 15, color: NAVY },
  meta: { fontFamily: SANS, fontSize: 11, color: NAVY3, marginTop: 3 },
  anchor: { alignItems: "flex-end", flexShrink: 0, maxWidth: "40%" },
  eyebrow: {
    fontFamily: SANS,
    fontSize: 10,
    color: NAVY3,
    fontWeight: "bold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  eyebrowVal: { fontFamily: SERIF, fontWeight: "bold", fontSize: 14, color: NAVY, marginTop: 2 },

  // table
  table: { marginHorizontal: 40 },
  thead: {
    flexDirection: "row",
    backgroundColor: BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER2,
  },
  th: {
    fontSize: 9,
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: NAVY3,
    fontWeight: "bold",
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  thCenter: { textAlign: "center" },

  trow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDER, alignItems: "center" },
  cellPad: { paddingVertical: 5, paddingHorizontal: 8 },
  tickCell: {
    width: W_TICK,
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  tickBox: { width: 8, height: 8, borderWidth: 1, borderColor: NAVY3 },
  refCell: { width: W_REF, fontFamily: MONO, fontSize: 10.5, color: NAVY },
  refPending: { color: NAVY3 },
  nameCell: { flex: 1, fontFamily: SANS, fontSize: 10.5, color: NAVY },
  scoreCell: { width: W_SCORE, fontFamily: MONO, fontSize: 10.5, color: NAVY, textAlign: "center" },

  emptyRow: {
    marginHorizontal: 40,
    paddingVertical: 24,
    textAlign: "center",
    fontSize: 10,
    color: NAVY3,
  },

  // footer legend + page number — repeats per page, pinned to the bottom
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 12,
  },
  // legend flex:1 (wraps if long); page number keeps its intrinsic width, pinned right — never
  // collide (the full verbatim legend + the page string don't fit one 515pt line at 10pt).
  legend: { fontFamily: SANS, fontSize: 8, color: NAVY3, flex: 1, paddingRight: 12 },
  pageNo: { fontFamily: MONO, fontSize: 8, color: NAVY3, flexShrink: 0, textAlign: "right" },
});

const SCORE_COLS: { key: "asg" | "ms" | "es" | "proj" | "port"; label: string }[] = [
  { key: "asg", label: "Asg" },
  { key: "ms", label: "MS" },
  { key: "es", label: "ES" },
  { key: "proj", label: "Proj" },
  { key: "port", label: "Port" },
];

export function StpshsScoreSheetDocument({ data }: { data: StpshsSheetData }) {
  const { school, subject, yearLabel, semLabel, generatedDate } = data;

  return (
    <Document
      title={`STPSHS Score Sheet — ${subject} · ${yearLabel} · ${semLabel}`}
      author="Omnischools"
      subject={`STPSHS Capture-Per-Subject sheet · ${school.name}`}
    >
      <Page size="A4" style={s.page}>
        {/* Strip + header block + thead — one fixed unit repeats at the top of every page (A3). */}
        <View fixed>
          <View style={s.strip} />
          <View style={s.head}>
            <View style={s.headRow}>
              <View style={s.headLeft}>
                <Text style={s.title}>{school.name} · STPSHS Score Sheet</Text>
                <Text style={s.meta}>
                  School code {school.code} · Generated {generatedDate} from Omnischools
                </Text>
              </View>
              <View style={s.anchor}>
                <Text style={s.eyebrow}>Subject · Year · Sem</Text>
                <Text style={s.eyebrowVal}>
                  {subject} · {yearLabel} · {semLabel}
                </Text>
              </View>
            </View>
          </View>
          <View style={s.table}>
            <View style={s.thead}>
              {/* Blank tick header — the box column is self-evident (glyph gotcha, §7). */}
              <Text style={[s.th, { width: W_TICK }]}> </Text>
              <Text style={[s.th, { width: W_REF }]}>Ass&apos;t Ref ID</Text>
              <Text style={[s.th, { flex: 1 }]}>Student name</Text>
              {SCORE_COLS.map((c) => (
                <Text key={c.key} style={[s.th, s.thCenter, { width: W_SCORE }]}>
                  {c.label}
                </Text>
              ))}
            </View>
          </View>
        </View>

        {/* tbody — flows below the fixed header on every page; a student never splits a break. */}
        <View style={s.table}>
          {data.rows.length === 0 ? (
            <Text style={s.emptyRow}>No scores entered for this period.</Text>
          ) : (
            data.rows.map((r, i) => (
              <View key={i} style={s.trow} wrap={false}>
                <View style={s.tickCell}>
                  <View style={s.tickBox} />
                </View>
                <Text
                  style={r.refPending ? [s.refCell, s.cellPad, s.refPending] : [s.refCell, s.cellPad]}
                >
                  {r.ref}
                </Text>
                <Text style={[s.nameCell, s.cellPad]}>{r.name}</Text>
                {SCORE_COLS.map((c) => (
                  <Text key={c.key} style={[s.scoreCell, s.cellPad]}>
                    {r[c.key]}
                  </Text>
                ))}
              </View>
            ))
          )}
        </View>

        {/* Footer legend + Page N of M — repeats per page (§6.1). */}
        <View style={s.footer} fixed>
          <Text style={s.legend}>
            Asg = assignments · MS = mid-sem · ES = end-of-sem · Proj = project · Port = portfolio
          </Text>
          <Text
            style={s.pageNo}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages} · Generated by Omnischools`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
