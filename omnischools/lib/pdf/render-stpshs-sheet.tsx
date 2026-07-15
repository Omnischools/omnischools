import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { StpshsScoreSheetDocument, type StpshsSheetData } from "./stpshs-score-sheet-document";

/** Render the STPSHS score sheet to a PDF Buffer (Node runtime only). */
export function renderStpshsSheetPdf(data: StpshsSheetData): Promise<Buffer> {
  return renderToBuffer(<StpshsScoreSheetDocument data={data} />);
}
