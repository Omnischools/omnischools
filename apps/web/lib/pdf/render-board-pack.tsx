import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { BoardPackDocument, type BoardPackData } from "./board-pack-document";

/** Render the GOV-5 board pack to a PDF Buffer (Node runtime only). Mirrors render-receipt. */
export function renderBoardPackPdf(data: BoardPackData): Promise<Buffer> {
  return renderToBuffer(<BoardPackDocument data={data} />);
}
