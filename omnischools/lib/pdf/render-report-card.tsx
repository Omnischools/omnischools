import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReportCardDocument, type ReportCardData } from "./report-card-document";

/** Render a terminal report card to a PDF Buffer (Node runtime only). */
export function renderReportCardPdf(data: ReportCardData): Promise<Buffer> {
  return renderToBuffer(<ReportCardDocument data={data} />);
}
