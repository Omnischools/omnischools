import { env } from "@/lib/env";

/**
 * Ledger scan-extraction abstraction (Path B, spec §4.2 / INCR-2). Feature code calls
 * `getLedgerExtractor()` and never a vendor SDK directly — a portability discipline, like
 * lib/sms (both call the vendor over plain fetch behind this interface). The real engine is
 * Claude Vision (Haiku 4.5, activated when ANTHROPIC_API_KEY is set); otherwise a deterministic
 * dev stub lets the whole verify-first flow run with no credentials or cost.
 *
 * The image is TRANSIENT (owner ruling 3 / G1–G4): it is passed in-flight to the extractor and
 * never persisted — no table, no column, no bucket, no temp file, no log. These types describe
 * only the extracted NUMBERS + confidences that come back; they are plain lib types (not tied to
 * any DB row) precisely because nothing about the scan is stored.
 */

/** One extracted cell: the number the model read (null = blank/unreadable) + its 0–1 confidence. */
export interface ExtractedCell {
  value: number | null;
  confidence: number;
}

/** One extracted ledger row: the handwritten name the model read (for teacher roster-confirm —
 * Kofi Q5), its best-guess student id (may be null / wrong — never trusted for an ambiguous
 * name), and the five raw category reads. */
export interface ExtractedRow {
  readName: string;
  studentId: string | null;
  cells: {
    asgn: ExtractedCell;
    midSem: ExtractedCell;
    endSem: ExtractedCell;
    project: ExtractedCell;
    portfolio: ExtractedCell;
  };
}

export interface ScanExtraction {
  rows: ExtractedRow[];
}

export interface ExtractorRosterEntry {
  id: string;
  name: string;
}

export interface ExtractInput {
  /** data: URL of the photographed ledger page — held only in memory, never persisted. */
  imageDataUrl: string;
  /** The class roster — Omnischools knows it, so the extractor proposes name→student mappings. */
  roster: ExtractorRosterEntry[];
}

export interface LedgerExtractor {
  /** Extract the five-category grid from a ledger photo, with a confidence per cell. */
  extract(input: ExtractInput): Promise<ScanExtraction>;
}

/** Resolve the extractor: Claude Vision if configured, else the deterministic dev stub. */
export async function getLedgerExtractor(): Promise<LedgerExtractor> {
  const key = env.ANTHROPIC_API_KEY;
  if (key) {
    const { ClaudeLedgerExtractor } = await import("./claude");
    return new ClaudeLedgerExtractor(key);
  }
  const { StubLedgerExtractor } = await import("./stub");
  return new StubLedgerExtractor();
}
