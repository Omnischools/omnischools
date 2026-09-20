import type { ScanExtraction, ExtractedCell, ExtractInput, LedgerExtractor } from "./index";

/**
 * Deterministic dev/stub extractor — fabricates a plausible five-category grid from the roster
 * (it does not read the image; that is the real Claude engine's job). Deterministic per student
 * so a re-scan is stable, and it deliberately produces a spread of confidences — including some
 * low-confidence and blank cells — so the verify-first UI can be built and demoed with no
 * credentials. The image is never touched or stored (transient guarantee holds in the stub too).
 */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export class StubLedgerExtractor implements LedgerExtractor {
  async extract(input: ExtractInput): Promise<ScanExtraction> {
    const cell = (studentId: string, salt: number): ExtractedCell => {
      const h = hash(`${studentId}:${salt}`);
      // Every ~11th cell is an unreadable blank (low confidence) — the teacher fills it.
      if (h % 11 === 0) return { value: null, confidence: 0.35 };
      const value = 45 + (h % 50); // 45..94, a realistic score spread
      const confidence = Math.round((0.6 + ((h >> 4) % 40) / 100) * 100) / 100; // 0.60..0.99
      return { value, confidence };
    };
    return {
      rows: input.roster.map((r) => ({
        readName: r.name,
        studentId: r.id,
        cells: {
          asgn: cell(r.id, 1),
          midSem: cell(r.id, 2),
          endSem: cell(r.id, 3),
          project: cell(r.id, 4),
          portfolio: cell(r.id, 5),
        },
      })),
    };
  }
}
