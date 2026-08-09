import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { CensusDocument, type CensusPdfData } from "./census-document";

/** Render the GOV-9 annual census to a PDF Buffer (Node runtime only — fontkit). Mirrors render-board-pack. */
export function renderCensusPdf(data: CensusPdfData): Promise<Buffer> {
  return renderToBuffer(<CensusDocument data={data} />);
}
