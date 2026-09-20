import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { SERIF, SANS, MONO } from "./fonts";
import type { OfficeRow, OfficersMatrix, PtaCard } from "@/lib/pta/officers";

/**
 * The PTA OFFICER ROSTER PDF (SHS module 4.7 · #297) — a print rendering of the /senior/pta/officers
 * matrix for a governance file. Board-pack pattern: it is fed the ALREADY-COMPOSED `OfficersMatrix`
 * verbatim (the same shape the on-screen matrix renders), so every field the page shows the document
 * shows — office, holder NAME, person-type, basis, term label, electionRef, vacancy markers and the
 * multi-hat "+N" — and NOTHING else.
 *
 * 🔴 PII FENCE (#297 · owner-ratified: roster only, NO contact). `OfficersMatrix` carries no officer
 * phone / email / address / studentGuardians field at all, so this presentational component structurally
 * cannot render contact PII — a mutation that reached for one would not compile (the field is absent from
 * the type). The pta-officer-roster.test.ts grep-guard re-asserts it at the source level.
 *
 * Honest absence (never fabricate a holder): a VACANT / EX_OFFICIO_VACANT / holderless-APPENDED_EX row
 * prints a vacancy marker, never a name; a school with zero active PTAs prints a valid one-page
 * "none configured" note (no 500). Core PDF fonts stand in for the brand faces (fonts.ts follow-up).
 */

// design tokens (hex; @react-pdf can't use CSS vars)
const NAVY = "#1A2B47";
const NAVY2 = "#2D3F5C";
const NAVY3 = "#5C6675";
const GOLD = "#C8975B";
const GOLD_SOFT = "#E8D4B8";
const GOLD_BG = "#F5EBDC";
const GREEN = "#2F6B47";
const GREEN_BG = "#E5EFE8";
const TERRA = "#B84A39";
const BORDER = "#E5DFD3";

export interface PtaOfficerRosterData {
  /** The composed matrix verbatim — the SAME shape the on-screen page renders (roster fields only). */
  matrix: OfficersMatrix;
  meta: {
    schoolName: string;
    schoolInitials: string;
    generatedAtLabel: string; // route-formatted (school tz/locale never reaches the doc)
  };
}

const s = StyleSheet.create({
  page: { backgroundColor: "#FFFFFF", fontFamily: SANS, fontSize: 10, color: NAVY, paddingBottom: 44, paddingTop: 10 },
  strip: { position: "absolute", top: 0, left: 0, right: 0, height: 6, backgroundColor: GOLD },

  cover: {
    backgroundColor: GOLD_BG,
    borderBottomWidth: 1,
    borderColor: GOLD_SOFT,
    alignItems: "center",
    paddingHorizontal: 40,
    paddingTop: 20,
    paddingBottom: 18,
  },
  mark: { width: 46, height: 46, backgroundColor: NAVY, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  markText: { fontFamily: SERIF, fontWeight: "bold", fontSize: 18, color: GOLD },
  coverSchool: { fontFamily: SERIF, fontWeight: "bold", fontSize: 22, color: NAVY, textAlign: "center" },
  coverTitle: { fontFamily: SERIF, fontSize: 13, color: NAVY, marginTop: 6, textAlign: "center" },
  coverGold: { color: GOLD },
  coverGen: { fontSize: 8.5, color: NAVY3, marginTop: 6 },
  coverFraming: { fontSize: 9, color: NAVY3, marginTop: 6, textAlign: "center" },

  body: { paddingHorizontal: 40, paddingTop: 14 },

  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12, marginBottom: 6 },
  sectionTitle: { fontFamily: SERIF, fontSize: 14, color: NAVY },
  sectionMeta: { fontSize: 8.5, color: NAVY3 },

  // one PTA card
  card: { borderWidth: 1, borderColor: BORDER, borderRadius: 6, marginBottom: 8 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: GREEN_BG, borderBottomWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 6 },
  cardLabel: { fontFamily: SERIF, fontSize: 11, fontWeight: "bold", color: NAVY },
  cardScope: { fontSize: 8, color: NAVY3 },
  cardCount: { fontFamily: MONO, fontSize: 8.5, color: NAVY2 },

  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 5 },
  rowLast: { borderBottomWidth: 0 },
  cOffice: { width: "22%", paddingRight: 6 },
  cHolder: { width: "34%", paddingRight: 6 },
  cBasis: { width: "18%", paddingRight: 6 },
  cTerm: { width: "26%" },

  office: { fontSize: 9.5, fontWeight: "bold", color: NAVY },
  exTag: { fontSize: 7.5, color: GOLD },
  holder: { fontSize: 9.5, color: NAVY2 },
  vacant: { fontSize: 9.5, color: TERRA, fontStyle: "italic" },
  meta: { fontSize: 7.5, color: NAVY3 },
  mono: { fontFamily: MONO, fontSize: 8, color: NAVY3 },

  emptyPanel: { borderWidth: 1, borderColor: BORDER, borderRadius: 6, padding: 16, marginTop: 16 },
  emptyText: { fontSize: 10, color: NAVY3, lineHeight: 1.5 },

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
});

/** The holder cell: an honest vacancy marker or the composed holder name + display tags (roster only). */
function HolderCell({ row }: { row: OfficeRow }) {
  const isVacant = row.kind === "VACANT";
  const isExVacant = row.kind === "EX_OFFICIO_VACANT" || (row.kind === "APPENDED_EX" && !row.holderName);
  if (isVacant) {
    return (
      <View style={s.cHolder}>
        <Text style={s.vacant}>Vacant</Text>
        {row.previousHolder ? (
          <Text style={s.meta}>
            previously {row.previousHolder}
            {row.vacantSince ? ` · since ${row.vacantSince}` : ""}
          </Text>
        ) : null}
      </View>
    );
  }
  if (isExVacant) {
    return (
      <View style={s.cHolder}>
        <Text style={s.vacant}>Not yet in post</Text>
        <Text style={s.meta}>derives automatically once set</Text>
      </View>
    );
  }
  return (
    <View style={s.cHolder}>
      <Text style={s.holder}>{row.holderName}</Text>
      <Text style={s.meta}>
        {row.personType ? row.personType : "—"}
        {row.otherHatCount > 0 ? ` · +${row.otherHatCount} other PTA role${row.otherHatCount === 1 ? "" : "s"}` : ""}
      </Text>
    </View>
  );
}

function OfficeLine({ row, last }: { row: OfficeRow; last: boolean }) {
  const exOfficio = row.kind === "EX_OFFICIO" || row.kind === "APPENDED_EX";
  return (
    <View style={[s.row, last ? s.rowLast : {}]} wrap={false}>
      <View style={s.cOffice}>
        <Text style={s.office}>{row.office}</Text>
        {exOfficio ? <Text style={s.exTag}>ex-officio</Text> : null}
      </View>
      <HolderCell row={row} />
      <View style={s.cBasis}>
        <Text style={s.meta}>{row.basisLabel ?? (exOfficio ? "Derived" : "—")}</Text>
        {row.electionRef ? <Text style={s.mono}>{row.electionRef}</Text> : null}
      </View>
      <View style={s.cTerm}>
        <Text style={s.meta}>{row.termLabel ?? "—"}</Text>
      </View>
    </View>
  );
}

function OfficerCard({ card }: { card: PtaCard }) {
  return (
    <View style={s.card} wrap={false}>
      <View style={s.cardHead}>
        <View>
          <Text style={s.cardLabel}>{card.label}</Text>
          {card.scopeBadge ? <Text style={s.cardScope}>{card.scopeBadge}</Text> : null}
        </View>
        <Text style={s.cardCount}>
          {card.filled}/{card.total} filled
        </Text>
      </View>
      {card.rows.map((row, i) => (
        <OfficeLine key={`${row.office}-${i}`} row={row} last={i === card.rows.length - 1} />
      ))}
    </View>
  );
}

function Section({ title, meta, cards }: { title: string; meta: string; cards: PtaCard[] }) {
  if (cards.length === 0) return null;
  return (
    <View>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        <Text style={s.sectionMeta}>{meta}</Text>
      </View>
      {cards.map((c) => (
        <OfficerCard key={c.id} card={c} />
      ))}
    </View>
  );
}

export function PtaOfficerRosterDocument({ data }: { data: PtaOfficerRosterData }) {
  const { matrix, meta } = data;
  const empty = matrix.general === null && matrix.houses.length === 0 && matrix.forms.length === 0;
  return (
    <Document
      title={`PTA Officer Roster — ${meta.schoolName}`}
      author="Omnischools"
      subject="PTA officer roster"
    >
      <Page size="A4" style={s.page}>
        <View style={s.strip} fixed />

        <View style={s.cover}>
          <View style={s.mark}>
            <Text style={s.markText}>{meta.schoolInitials}</Text>
          </View>
          <Text style={s.coverSchool}>{meta.schoolName}</Text>
          <Text style={s.coverTitle}>
            PTA Officer <Text style={s.coverGold}>Roster</Text>
          </Text>
          <Text style={s.coverGen}>Generated {meta.generatedAtLabel}</Text>
          <Text style={s.coverFraming}>
            Governance roster · offices, holders and terms only. No contact details.
          </Text>
        </View>

        <View style={s.body}>
          {empty ? (
            <View style={s.emptyPanel}>
              <Text style={s.emptyText}>
                No active PTAs are configured for this school yet. Configure the tiers and run Generate on
                the PTA Setup tab, then assign officers — the roster will populate here.
              </Text>
            </View>
          ) : (
            <>
              {matrix.general ? <Section title="General PTA" meta="Executive" cards={[matrix.general]} /> : null}
              <Section
                title="House PTAs"
                meta={`${matrix.totals.houses.filled}/${matrix.totals.houses.total} filled`}
                cards={matrix.houses}
              />
              <Section
                title="Form PTAs"
                meta={`${matrix.totals.forms.filled}/${matrix.totals.forms.total} filled`}
                cards={matrix.forms}
              />
            </>
          )}
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Prepared on <Text style={s.goldEm}>Omnischools</Text> · the school management platform
          </Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `${meta.schoolName} · PTA officers · ${pageNumber}/${totalPages}`}
            fixed
          />
        </View>
      </Page>
    </Document>
  );
}
