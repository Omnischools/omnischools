import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { SERIF, SANS, MONO } from "./fonts";
import { SPARE_ROWS } from "@/lib/score-ledger/ledger-book";

/**
 * Omnischools-branded blank paper ledger book (A4) — INCR-5 · Score Ledger Item 6. A near-mechanical
 * clone of stpshs-score-sheet-document.tsx, minus every score column: the book is BLANK, a printed
 * grid a teacher hand-writes scores into (spec §4.2 / Path B source). Six columns L→R —
 * `Student name · Asg · MS · ES · Proj · Port` (AC B1) — NO tick / Ass't-Ref-ID / weighted-total
 * column (B3). Every category cell renders empty (B2). Pre-printed ACTIVE roster names in the left
 * column, then ~4 spare UNLABELED rows for late enrollees (§I). Per-page corner-stamp + brand header.
 * Presentational only: every value arrives pre-formatted from lib/data/ledger-book-data.
 */

// --- design tokens (hex; @react-pdf can't use CSS vars) — mirror the STPSHS sheet ---
const NAVY = "#1A2B47";
const NAVY3 = "#5C6675";
const GOLD = "#C8975B";
const BG = "#FAF7F2";
const BORDER = "#E5DFD3";
const BORDER2 = "#D4CCBA";

export type LedgerBookRow = {
  /** Pre-printed student name (`First Last`); the ONLY data on a blank-book row (no scores). */
  name: string;
};

export type LedgerBookData = {
  school: { name: string; code: string };
  generatedDate: string; // "27 June 2026" (day month year), pre-formatted by the builder
  subject: string;
  className: string; // human class label for the corner-stamp, e.g. "Form 2 Science"
  yearLabel: string; // "Y2"
  semLabel: string; // "S2" (never "T2" — Trap 1 / AC C2: SHS is semesters, logic wins)
  rows: LedgerBookRow[];
};

// Column widths for a 515pt A4 content band; name is the flexible column. Score cells are WIDE
// (60pt) blank writing boxes — this is a handwriting grid, not a printed value (B2).
const W_SCORE = 60;
// A comfortable handwriting-row height so blank cells are a usable writing box.
const ROW_H = 26;

const s = StyleSheet.create({
  // paddingBottom reserves the fixed-footer band; the fixed header sits in normal flow.
  page: { backgroundColor: "#FFFFFF", fontFamily: SANS, fontSize: 10, color: NAVY, paddingBottom: 54 },
  strip: { height: 6, backgroundColor: GOLD },

  // header block
  head: { marginHorizontal: 40, marginTop: 24 },
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
  headLeft: { flex: 1, paddingRight: 16, flexDirection: "row", alignItems: "flex-start" },
  // Token placeholder brand mark — gold "O" on a navy tile (Item-5 posture; E3: NOT a real
  // trademark asset — the real mark swaps in before the print run is commissioned).
  brandBadge: {
    width: 26,
    height: 26,
    borderRadius: 5,
    backgroundColor: NAVY,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  brandO: { fontFamily: SERIF, fontWeight: "bold", fontSize: 16, color: GOLD },
  brandName: {
    fontFamily: SANS,
    fontSize: 9,
    fontWeight: "bold",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: GOLD,
  },
  title: { fontFamily: SERIF, fontWeight: "bold", fontSize: 15, color: NAVY, marginTop: 1 },
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

  // per-page corner-stamp (top-right) — mirrors the surface .scan-corner-stamp; plain text, NOT a
  // QR and NOT the receipt doc's navy placeholder square (honesty gate, AC C4).
  stampWrap: { position: "absolute", top: 12, left: 40, right: 40, flexDirection: "row", justifyContent: "flex-end" },
  cornerStamp: {
    fontFamily: MONO,
    fontSize: 7.5,
    color: NAVY3,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },

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
  thScore: { width: W_SCORE, textAlign: "center", borderLeftWidth: 1, borderLeftColor: BORDER2 },

  trow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    alignItems: "center",
    minHeight: ROW_H,
  },
  nameCell: { flex: 1, fontFamily: SANS, fontSize: 10.5, color: NAVY, paddingVertical: 5, paddingHorizontal: 8 },
  // Empty writing box — the borderLeft draws the vertical grid line between categories.
  scoreCell: { width: W_SCORE, alignSelf: "stretch", borderLeftWidth: 1, borderLeftColor: BORDER },

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

export function LedgerBookDocument({ data }: { data: LedgerBookData }) {
  const { school, subject, className, yearLabel, semLabel, generatedDate } = data;

  return (
    <Document
      title={`Omnischools Ledger Book — ${subject} · ${yearLabel} · ${semLabel}`}
      author="Omnischools"
      subject={`Blank paper ledger book · ${school.name}`}
    >
      <Page size="A4" style={s.page}>
        {/* Strip + brand header + thead — one fixed unit repeats at the top of every page (D1/D2). */}
        <View fixed>
          <View style={s.strip} />
          <View style={s.head}>
            <View style={s.headRow}>
              <View style={s.headLeft}>
                <View style={s.brandBadge}>
                  <Text style={s.brandO}>O</Text>
                </View>
                <View>
                  <Text style={s.brandName}>Omnischools</Text>
                  <Text style={s.title}>{school.name} · Ledger Book</Text>
                  <Text style={s.meta}>
                    School code {school.code} · Generated {generatedDate}
                  </Text>
                </View>
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
              <Text style={[s.th, { flex: 1 }]}>Student name</Text>
              {SCORE_COLS.map((c) => (
                <Text key={c.key} style={[s.th, s.thScore]}>
                  {c.label}
                </Text>
              ))}
            </View>
          </View>
        </View>

        {/* Per-page corner-stamp — labels + page index only, no name/score/teacher/UUID (C3). */}
        <View style={s.stampWrap} fixed>
          <Text
            style={s.cornerStamp}
            render={({ pageNumber, totalPages }) =>
              `PAGE ${pageNumber}/${totalPages} · ${className} · ${subject} · ${semLabel}`
            }
          />
        </View>

        {/* tbody — flows below the fixed header on every page; a student never splits a break (D4). */}
        <View style={s.table}>
          {data.rows.map((r, i) => (
            <View key={i} style={s.trow} wrap={false}>
              <Text style={s.nameCell}>{r.name}</Text>
              {SCORE_COLS.map((c) => (
                <View key={c.key} style={s.scoreCell} />
              ))}
            </View>
          ))}
          {/* ~4 spare UNLABELED rows — handwriting slack for late-enrolled students (§I). NOT
              students: no name, five empty columns, excluded from the count + audit. */}
          {Array.from({ length: SPARE_ROWS }).map((_, i) => (
            <View key={`spare-${i}`} style={s.trow} wrap={false}>
              <View style={{ flex: 1 }} />
              {SCORE_COLS.map((c) => (
                <View key={c.key} style={s.scoreCell} />
              ))}
            </View>
          ))}
        </View>

        {/* Footer legend + Page N of M — repeats per page (D3). */}
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
