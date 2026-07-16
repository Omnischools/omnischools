import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { LedgerBookDocument, type LedgerBookData } from "./ledger-book-document";

/** Render the Omnischools blank paper ledger book to a PDF Buffer (Node runtime only). */
export function renderLedgerBookPdf(data: LedgerBookData): Promise<Buffer> {
  return renderToBuffer(<LedgerBookDocument data={data} />);
}
