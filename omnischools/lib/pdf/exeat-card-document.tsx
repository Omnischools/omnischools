import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { SERIF, SANS, MONO } from "./fonts";

/**
 * Printable exeat card (SHS module 4.2 / INCR-9) — the legal artefact a boarder carries home,
 * a snapshot of the digital exeat record at departure (surface 05 .card-art). Reuses the
 * ledger-book @react-pdf stack (Node runtime, core fonts, no puppeteer). Every value arrives
 * pre-formatted from lib/boarding/exeat-data (getExeatCardData); this file is presentational only.
 *
 * Fields (F1): ref_code · student · form·House·bunk · type · date-out (departed_at) / date-in
 * (return_by) · Dress = getExeatPolicy.dressCode · fee line · signer = getExeatPolicy.cardSigner
 * label + the ACTUAL SR_HM_SIGNED actor name (never hardcoded — the surface has a name-mismatch
 * drift the logic must beat).
 */

// design tokens (hex; @react-pdf can't use CSS vars) — mirror surface 05 :root
const NAVY = "#1A2B47";
const NAVY2 = "#2D3F5C";
const GOLD = "#C8975B";
const GOLD_SOFT = "#E8D4B8";
const GOLD_BG = "#F5EBDC";
const BG = "#FAF7F2";

export type ExeatCardPdfData = {
  school: { name: string; code: string };
  refCode: string;
  studentName: string;
  formHouseBunk: string;
  typeLabel: string;
  dateOut: string;
  dateIn: string;
  dressCode: string;
  feeLine: string;
  signerLabel: string;
  signerActor: string | null;
  houseName: string;
  academicYear: string;
};

const s = StyleSheet.create({
  page: { backgroundColor: BG, fontFamily: SANS, fontSize: 11, color: NAVY, padding: 40 },
  card: { borderWidth: 1.5, borderColor: GOLD, borderRadius: 14, overflow: "hidden", backgroundColor: "#FFFFFF" },

  head: {
    backgroundColor: NAVY,
    paddingVertical: 16,
    paddingHorizontal: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headEyebrow: { fontSize: 8, letterSpacing: 1.4, color: GOLD, fontWeight: "bold", textTransform: "uppercase" },
  headTitle: { fontFamily: SERIF, fontSize: 16, fontWeight: "bold", color: BG, marginTop: 3 },
  headHouse: { fontFamily: SERIF, fontStyle: "italic", color: GOLD },
  headRef: { fontFamily: MONO, fontSize: 9, color: GOLD_SOFT },

  body: { paddingVertical: 8, paddingHorizontal: 22 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: GOLD_SOFT,
    borderBottomStyle: "dashed",
  },
  lineLast: { borderBottomWidth: 0 },
  lineLabel: { width: 96, fontSize: 8, letterSpacing: 0.6, textTransform: "uppercase", color: GOLD, fontWeight: "bold" },
  lineValue: { flex: 1, fontFamily: SERIF, fontSize: 13, fontWeight: "bold", color: NAVY },
  lineValueEm: { fontFamily: SERIF, fontStyle: "italic", fontSize: 13, color: GOLD },

  foot: {
    backgroundColor: GOLD_BG,
    borderTopWidth: 1,
    borderTopColor: GOLD_SOFT,
    paddingVertical: 16,
    paddingHorizontal: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footLabel: { fontSize: 8, letterSpacing: 0.6, textTransform: "uppercase", color: NAVY2, fontWeight: "bold" },
  footSig: { fontFamily: SERIF, fontStyle: "italic", fontSize: 14, color: NAVY, marginTop: 3 },
  stamp: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    borderColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
  },
  stampText: { fontFamily: SERIF, fontStyle: "italic", fontSize: 8, color: GOLD, fontWeight: "bold", textAlign: "center" },

  note: { marginTop: 18, fontSize: 8, color: NAVY2, textAlign: "center", lineHeight: 1.5 },
});

function CardLine({ label, value, em, last }: { label: string; value: string; em?: boolean; last?: boolean }) {
  return (
    <View style={last ? [s.line, s.lineLast] : s.line}>
      <Text style={s.lineLabel}>{label}</Text>
      <Text style={em ? [s.lineValue, s.lineValueEm] : s.lineValue}>{value}</Text>
    </View>
  );
}

export function ExeatCardDocument({ data }: { data: ExeatCardPdfData }) {
  return (
    <Document
      title={`Exeat card — ${data.refCode}`}
      author="Omnischools"
      subject={`Exeat card · ${data.school.name}`}
    >
      <Page size="A5" style={s.page}>
        <View style={s.card}>
          <View style={s.head}>
            <View>
              <Text style={s.headEyebrow}>Exeat card · {data.academicYear}</Text>
              <Text style={s.headTitle}>
                {data.school.name} <Text style={s.headHouse}>· {data.houseName} House</Text>
              </Text>
            </View>
            <Text style={s.headRef}>{data.refCode}</Text>
          </View>

          <View style={s.body}>
            <CardLine label="Student" value={data.studentName} />
            <CardLine label="Form & House" value={data.formHouseBunk} />
            <CardLine label="Type" value={data.typeLabel} em />
            <CardLine label="Date out" value={data.dateOut} />
            <CardLine label="Date in" value={data.dateIn} em />
            <CardLine label="Dress" value={data.dressCode} />
            <CardLine label="Fees" value={data.feeLine} last />
          </View>

          <View style={s.foot}>
            <View>
              <Text style={s.footLabel}>{data.signerLabel}</Text>
              <Text style={s.footSig}>signed · {data.signerActor ?? "pending"}</Text>
            </View>
            <View style={s.stamp}>
              <Text style={s.stampText}>SCHOOL{"\n"}STAMP</Text>
            </View>
          </View>
        </View>

        <Text style={s.note}>
          This card records the transfer of responsibility for this boarder from the school to the
          parent/guardian for the window shown. One card per exeat · not transferable · refusable at
          the gate if unsigned. School code {data.school.code} · generated by Omnischools.
        </Text>
      </Page>
    </Document>
  );
}
