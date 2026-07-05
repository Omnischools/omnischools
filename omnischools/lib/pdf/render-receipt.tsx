import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReceiptDocument, type ReceiptData } from "./receipt-document";

/** Render a receipt to a PDF Buffer (Node runtime only). */
export function renderReceiptPdf(data: ReceiptData): Promise<Buffer> {
  return renderToBuffer(<ReceiptDocument data={data} />);
}
