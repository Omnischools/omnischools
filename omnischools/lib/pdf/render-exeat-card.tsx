import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { ExeatCardDocument, type ExeatCardPdfData } from "./exeat-card-document";

/** Render one exeat card to a PDF Buffer (Node runtime only — @react-pdf uses fontkit). */
export function renderExeatCardPdf(data: ExeatCardPdfData): Promise<Buffer> {
  return renderToBuffer(<ExeatCardDocument data={data} />);
}
