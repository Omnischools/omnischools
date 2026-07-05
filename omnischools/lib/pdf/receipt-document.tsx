import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { SERIF, SANS, MONO } from "./fonts";

/**
 * Printable payment-receipt PDF — a 1:1 replication of Surfaces/schoolup-receipt-pdf.html
 * (A5 portrait). Presentational only: all values arrive pre-formatted from the route so this
 * component does no data access or locale work. Supports the standard, multi-invoice
 * (allocation band) and voided states from the surface.
 *
 * Sizing: type + spacing are tuned so the whole receipt fits on ONE A5 page for the common
 * case (and stays within one page for typical multi-invoice / voided receipts). Very long
 * line-item lists can still flow to a second page — @react-pdf paginates automatically.
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
const TERRA = "#B84A39";
const TERRA_BG = "#F5E1DC";
const BORDER = "#E5DFD3";

const ghs = (v: number) =>
  `GHS ${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type ReceiptLine = {
  main: string;
  sub?: string | null;
  period?: string | null;
  amount: number;
};
export type ReceiptAllocation = {
  invoiceNumber: string;
  description: string;
  amount: number;
};
export type ReceiptData = {
  school: {
    name: string;
    initials: string;
    addressLine?: string | null;
    idLine?: string | null;
  };
  receiptNumber: string;
  issuedAt: string;
  payer: { name: string; sub?: string | null };
  student: { name: string; sub?: string | null };
  amount: number;
  amountInWords: string;
  lines: ReceiptLine[];
  allocations?: ReceiptAllocation[] | null;
  method: { label: string; reference?: string | null; sub?: string | null };
  recordedBy?: { name: string; role?: string | null } | null;
  context?: string | null;
  voided?: {
    at: string;
    by?: string | null;
    reason?: string | null;
    replacement?: string | null;
  } | null;
};

const s = StyleSheet.create({
  page: { backgroundColor: "#FFFFFF", fontFamily: SANS, fontSize: 9, color: NAVY },
  strip: { height: 5, backgroundColor: GOLD },

  // header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 32,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  schoolRow: { flexDirection: "row", gap: 10 },
  mark: {
    width: 38,
    height: 38,
    backgroundColor: NAVY,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  markText: { fontFamily: SERIF, fontWeight: "bold", fontSize: 14, color: GOLD },
  schoolName: { fontFamily: SERIF, fontWeight: "bold", fontSize: 13, color: NAVY, marginBottom: 2 },
  metaLine: { fontSize: 8, color: NAVY3, lineHeight: 1.45 },
  anchor: { alignItems: "flex-end" },
  docType: { fontSize: 7.5, color: GOLD, fontWeight: "bold", letterSpacing: 1, marginBottom: 2 },
  receiptNo: { fontFamily: SERIF, fontWeight: "bold", fontSize: 13, color: NAVY, marginBottom: 2 },
  issued: { fontSize: 8, color: NAVY3 },

  // payer
  payer: {
    flexDirection: "row",
    paddingHorizontal: 32,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    borderStyle: "dashed",
  },
  cell: { flex: 1 },
  lbl: { fontSize: 7, color: GOLD, fontWeight: "bold", letterSpacing: 0.8, marginBottom: 2 },
  lblDark: { fontSize: 7, color: NAVY3, fontWeight: "bold", letterSpacing: 0.8, marginBottom: 2 },
  val: { fontFamily: SERIF, fontWeight: "bold", fontSize: 11, color: NAVY, lineHeight: 1.25 },
  sub: { fontSize: 8, color: NAVY3, marginTop: 1, lineHeight: 1.35 },

  // body
  body: { paddingHorizontal: 32, paddingTop: 8 },
  banner: {
    backgroundColor: BG,
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
    marginBottom: 8,
  },
  bannerLbl: { fontSize: 7, color: GOLD, fontWeight: "bold", letterSpacing: 1, marginBottom: 2 },
  valRow: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  amount: { fontFamily: SERIF, fontWeight: "bold", fontSize: 21, color: NAVY },
  inWords: { fontSize: 8, color: NAVY3, fontStyle: "italic", flex: 1, lineHeight: 1.35, paddingBottom: 2 },

  // allocation band
  alloc: {
    backgroundColor: GOLD_BG,
    marginHorizontal: -32,
    paddingHorizontal: 32,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: GOLD_SOFT,
    marginBottom: 7,
  },
  allocHead: { fontSize: 7, color: GOLD, fontWeight: "bold", letterSpacing: 0.8, marginBottom: 5 },
  allocRow: { flexDirection: "row", gap: 12, paddingVertical: 4, alignItems: "center" },
  invId: { fontFamily: MONO, fontSize: 8, color: GOLD, fontWeight: "bold", width: 88 },
  invDesc: { fontFamily: SERIF, fontSize: 9.5, color: NAVY, flex: 1 },
  invAmt: { fontFamily: SERIF, fontWeight: "bold", fontSize: 9.5, color: GREEN, width: 70, textAlign: "right" },

  // table
  table: { borderTopWidth: 1, borderTopColor: BORDER },
  thead: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  th: { fontSize: 7, color: NAVY3, fontWeight: "bold", letterSpacing: 0.8 },
  trow: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    borderStyle: "dashed",
  },
  colDesc: { flex: 1 },
  colPeriod: { width: 66, textAlign: "right" },
  colAmt: { width: 76, textAlign: "right" },
  tdMain: { fontFamily: SERIF, fontWeight: "bold", fontSize: 10, color: NAVY },
  tdSub: { fontSize: 7.5, color: NAVY3, marginTop: 1 },
  tdPeriod: { fontFamily: SERIF, fontSize: 9.5, color: NAVY3 },
  tdAmt: { fontFamily: SERIF, fontWeight: "bold", fontSize: 9.5, color: NAVY },

  totals: { flexDirection: "row", justifyContent: "flex-end", marginTop: 4 },
  totalLbl: {
    fontSize: 10,
    fontWeight: "bold",
    color: NAVY,
    textAlign: "right",
    borderTopWidth: 2,
    borderTopColor: NAVY,
    paddingTop: 6,
    paddingRight: 16,
  },
  totalVal: {
    fontFamily: SERIF,
    fontWeight: "bold",
    fontSize: 13,
    color: NAVY,
    width: 90,
    textAlign: "right",
    borderTopWidth: 2,
    borderTopColor: NAVY,
    paddingTop: 6,
  },

  contextBox: {
    marginTop: 8,
    padding: 9,
    backgroundColor: BG,
    borderRadius: 6,
    fontSize: 8,
    color: NAVY3,
    lineHeight: 1.45,
  },
  bold: { color: NAVY, fontWeight: "bold" },

  // payment method
  method: {
    flexDirection: "row",
    paddingHorizontal: 32,
    paddingVertical: 7,
    marginTop: 10,
    backgroundColor: BG,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  methodVal: { fontFamily: SERIF, fontWeight: "bold", fontSize: 10.5, color: NAVY },
  methodMono: { fontFamily: MONO, fontSize: 9.5, color: NAVY, fontWeight: "bold" },

  // footer
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 32,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  stamp: {
    width: 84,
    height: 40,
    borderWidth: 1.5,
    borderColor: GOLD_SOFT,
    borderStyle: "dashed",
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    transform: "rotate(-4deg)",
    marginBottom: 6,
  },
  stampText: { fontFamily: SERIF, fontStyle: "italic", fontSize: 7.5, color: GOLD, textAlign: "center", lineHeight: 1.2 },
  sigLine: { width: 120, borderBottomWidth: 1, borderBottomColor: NAVY, paddingBottom: 1 },
  sigName: { fontFamily: SERIF, fontWeight: "bold", fontSize: 9, color: NAVY, marginTop: 4 },
  sigRole: { fontSize: 8, color: NAVY3 },
  qrBlock: { alignItems: "center" },
  qr: { width: 48, height: 48, backgroundColor: NAVY, borderRadius: 4, marginBottom: 3 },
  qrLabel: { fontSize: 7, color: NAVY3, letterSpacing: 0.3 },

  platform: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 32,
    paddingTop: 8,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  platformText: { fontSize: 7, color: NAVY3, letterSpacing: 0.3 },
  goldEm: { color: GOLD, fontWeight: "bold" },
  verifyUrl: { fontFamily: MONO, fontSize: 7, color: NAVY3, letterSpacing: 0.2 },

  // void
  voidBanner: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 32,
    paddingVertical: 7,
    backgroundColor: TERRA_BG,
    borderTopWidth: 2,
    borderTopColor: TERRA,
  },
  voidIc: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: TERRA,
    color: "#FFFFFF",
    fontFamily: SERIF,
    fontWeight: "bold",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 1.5,
  },
  voidTitle: { fontFamily: SERIF, fontWeight: "bold", fontSize: 10, color: TERRA, marginBottom: 1 },
  voidBody: { fontSize: 8, color: NAVY2, lineHeight: 1.45, flex: 1 },
  voidStampWrap: {
    position: "absolute",
    top: 290,
    left: 110,
  },
  voidStamp: {
    borderWidth: 5,
    borderColor: TERRA,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 26,
    transform: "rotate(-12deg)",
  },
  voidStampText: { fontFamily: SERIF, fontWeight: "bold", fontSize: 52, color: TERRA, letterSpacing: 4 },
});

export function ReceiptDocument({ data }: { data: ReceiptData }) {
  const isVoid = !!data.voided;
  const bodyOpacity = isVoid ? 0.55 : 1;
  const allocations = data.allocations ?? [];

  return (
    <Document
      title={`Receipt ${data.receiptNumber}`}
      author="Omnischools"
      subject={`Payment receipt for ${data.student.name}`}
    >
      <Page size="A5" style={s.page}>
        <View style={s.strip} />

        {isVoid && (
          <View style={s.voidBanner}>
            <Text style={s.voidIc}>!</Text>
            <View style={s.voidBody}>
              <Text style={s.voidTitle}>This receipt has been voided</Text>
              <Text>
                Voided {data.voided?.at}
                {data.voided?.by ? ` by ${data.voided.by}` : ""}
                {data.voided?.reason ? (
                  <Text>
                    {" · reason: "}
                    <Text style={s.bold}>&ldquo;{data.voided.reason}&rdquo;</Text>
                  </Text>
                ) : null}
                . The original payment was reversed; this receipt is no longer a valid record
                of payment.
                {data.voided?.replacement ? ` Replacement: ${data.voided.replacement}.` : ""}
              </Text>
            </View>
          </View>
        )}

        <View style={{ opacity: bodyOpacity }}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.schoolRow}>
              <View style={s.mark}>
                <Text style={s.markText}>{data.school.initials}</Text>
              </View>
              <View>
                <Text style={s.schoolName}>{data.school.name}</Text>
                {data.school.addressLine ? (
                  <Text style={s.metaLine}>{data.school.addressLine}</Text>
                ) : null}
                {data.school.idLine ? (
                  <Text style={s.metaLine}>{data.school.idLine}</Text>
                ) : null}
              </View>
            </View>
            <View style={s.anchor}>
              <Text style={s.docType}>OFFICIAL RECEIPT</Text>
              <Text style={s.receiptNo}>{data.receiptNumber}</Text>
              <Text style={s.issued}>Issued {data.issuedAt}</Text>
            </View>
          </View>

          {/* Payer */}
          <View style={s.payer}>
            <View style={s.cell}>
              <Text style={s.lbl}>RECEIVED FROM</Text>
              <Text style={s.val}>{data.payer.name}</Text>
              {data.payer.sub ? <Text style={s.sub}>{data.payer.sub}</Text> : null}
            </View>
            <View style={s.cell}>
              <Text style={s.lbl}>FOR THE ACCOUNT OF</Text>
              <Text style={s.val}>{data.student.name}</Text>
              {data.student.sub ? <Text style={s.sub}>{data.student.sub}</Text> : null}
            </View>
          </View>

          {/* Body */}
          <View style={s.body}>
            <View style={s.banner}>
              <Text style={s.bannerLbl}>TOTAL RECEIVED</Text>
              <View style={s.valRow}>
                <Text style={s.amount}>{ghs(data.amount)}</Text>
                <Text style={s.inWords}>{data.amountInWords}</Text>
              </View>
            </View>

            {allocations.length > 1 && (
              <View style={s.alloc}>
                <Text style={s.allocHead}>
                  SETTLED ACROSS {allocations.length} INVOICES
                </Text>
                {allocations.map((a, i) => (
                  <View key={i} style={s.allocRow}>
                    <Text style={s.invId}>{a.invoiceNumber}</Text>
                    <Text style={s.invDesc}>{a.description}</Text>
                    <Text style={s.invAmt}>{ghs(a.amount)}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={s.table}>
              <View style={s.thead}>
                <Text style={[s.th, s.colDesc]}>Description</Text>
                <Text style={[s.th, s.colPeriod]}>Period</Text>
                <Text style={[s.th, s.colAmt]}>Amount</Text>
              </View>
              {data.lines.map((li, i) => (
                <View key={i} style={s.trow}>
                  <View style={s.colDesc}>
                    <Text style={s.tdMain}>{li.main}</Text>
                    {li.sub ? <Text style={s.tdSub}>{li.sub}</Text> : null}
                  </View>
                  <Text style={[s.tdPeriod, s.colPeriod]}>{li.period ?? ""}</Text>
                  <Text style={[s.tdAmt, s.colAmt]}>{ghs(li.amount)}</Text>
                </View>
              ))}
              <View style={s.totals}>
                <Text style={s.totalLbl}>Paid this transaction</Text>
                <Text style={s.totalVal}>{ghs(data.amount)}</Text>
              </View>
            </View>

            {data.context ? (
              <Text style={s.contextBox}>{data.context}</Text>
            ) : null}
          </View>

          {/* Payment method */}
          <View style={s.method}>
            <View style={s.cell}>
              <Text style={s.lblDark}>METHOD</Text>
              <Text style={s.methodVal}>{data.method.label}</Text>
              {data.method.sub ? <Text style={s.sub}>{data.method.sub}</Text> : null}
            </View>
            <View style={s.cell}>
              <Text style={s.lblDark}>TRANSACTION ID</Text>
              <Text style={s.methodMono}>{data.method.reference ?? "—"}</Text>
            </View>
            <View style={s.cell}>
              <Text style={s.lblDark}>RECORDED BY</Text>
              <Text style={s.methodVal}>{data.recordedBy?.name ?? "—"}</Text>
              {data.recordedBy?.role ? (
                <Text style={s.sub}>{data.recordedBy.role}</Text>
              ) : null}
            </View>
          </View>

          {/* Footer — signature + QR */}
          <View style={s.footer}>
            <View>
              <View style={s.stamp}>
                <Text style={s.stampText}>{data.school.name}</Text>
                <Text style={s.stampText}>OFFICIAL</Text>
              </View>
              <View style={s.sigLine} />
              <Text style={s.sigName}>{data.recordedBy?.name ?? data.school.name}</Text>
              <Text style={s.sigRole}>Authorised officer</Text>
            </View>
            <View style={s.qrBlock}>
              <View style={s.qr} />
              <Text style={s.qrLabel}>Verify at omnischools.gh/r</Text>
            </View>
          </View>

          {/* Platform footer */}
          <View style={s.platform}>
            <Text style={s.platformText}>
              Issued on <Text style={s.goldEm}>Omnischools</Text> · the school management
              platform
            </Text>
            <Text style={s.verifyUrl}>
              omnischools.gh/r/{data.receiptNumber}
              {isVoid ? " · VOIDED" : ""}
            </Text>
          </View>
        </View>

        {isVoid && (
          <View style={s.voidStampWrap} fixed>
            <View style={s.voidStamp}>
              <Text style={s.voidStampText}>VOID</Text>
            </View>
          </View>
        )}
      </Page>
    </Document>
  );
}
