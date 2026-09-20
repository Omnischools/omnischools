import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { PtaOfficerRosterDocument, type PtaOfficerRosterData } from "./pta-officer-roster-document";

/** Render the PTA officer roster to a PDF Buffer (Node runtime only). Mirrors render-board-pack. */
export function renderPtaOfficerRosterPdf(data: PtaOfficerRosterData): Promise<Buffer> {
  return renderToBuffer(<PtaOfficerRosterDocument data={data} />);
}
