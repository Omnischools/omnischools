import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReadinessStatementDocument, type ReadinessStatementData } from "./readiness-statement-document";

/** Render a WASSCE readiness statement to a PDF Buffer (Node runtime only). Mirrors render-receipt. */
export function renderReadinessStatementPdf(data: ReadinessStatementData): Promise<Buffer> {
  return renderToBuffer(<ReadinessStatementDocument data={data} />);
}
