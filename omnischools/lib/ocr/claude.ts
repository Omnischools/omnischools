import type {
  ScanExtraction,
  ExtractInput,
  LedgerExtractor,
} from "./index";

/**
 * Claude-Vision ledger extractor (Path B real engine). Dormant unless ANTHROPIC_API_KEY is set —
 * getLedgerExtractor() dynamically imports this module only then, so dev/CI never load it and the
 * key never reaches a client bundle. Follows the house portability discipline (like lib/sms →
 * Hubtel): the vendor is called over plain `fetch`, never a vendor SDK, so this file is the only
 * place that knows the wire shape — a Sonnet 5 upgrade later is a one-constant swap (owner ruling 1).
 *
 * Request shape (verified against the Anthropic Messages API for Haiku 4.5, `anthropic-version:
 * 2023-06-01`): structured output is obtained with a FORCED tool call — a single tool whose
 * `input_schema` is our grid shape + `tool_choice: {type:"tool"}` — the GA, model-agnostic way to
 * constrain output. (The salvaged WIP used `output_config` + `thinking:{type:"adaptive"}`; neither
 * is a valid Messages-API field, so both were dropped. Haiku 4.5 needs no thinking to transcribe a
 * grid, and forcing a tool is incompatible with extended thinking anyway.)
 *
 * The image is transient: it is read from the in-memory data URL, sent once, and never stored or
 * logged (G1–G4) — this module holds no reference to it after the request resolves.
 */

/** The one place the model id lives. Swap to `claude-sonnet-5` post-go-live — no other change. */
const MODEL = "claude-haiku-4-5-20251001";
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const TOOL_NAME = "record_ledger_grid";

/** One extracted cell: a number (0–100+ raw, scaled downstream) or null (blank), plus 0–1 confidence. */
const CELL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["value", "confidence"],
  properties: {
    value: { type: ["number", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

/** The whole grid: one row per handwritten line, with the name read + a best-guess student id. */
const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["readName", "studentId", "cells"],
        properties: {
          readName: { type: "string" },
          studentId: { type: ["string", "null"] },
          cells: {
            type: "object",
            additionalProperties: false,
            required: ["asgn", "midSem", "endSem", "project", "portfolio"],
            properties: {
              asgn: CELL_SCHEMA,
              midSem: CELL_SCHEMA,
              endSem: CELL_SCHEMA,
              project: CELL_SCHEMA,
              portfolio: CELL_SCHEMA,
            },
          },
        },
      },
    },
  },
} as const;

/** Split a `data:<mime>;base64,<data>` URL into the parts the Messages API image block needs. */
function parseDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Ledger extract: image must be a base64 image data URL");
  return { mediaType: m[1], data: m[2] };
}

function buildPrompt(roster: ExtractInput["roster"]): string {
  const list = roster.map((r) => `- ${r.id}: ${r.name}`).join("\n");
  return [
    "This is a photograph of a paper score-ledger page for one class and subject.",
    "Each student row has five handwritten score columns, in this order:",
    "1) assignments / class exercises, 2) mid-semester exam, 3) end-of-semester exam,",
    "4) project work, 5) portfolio.",
    "",
    "Return one object per handwritten row. For each row:",
    "- readName: the handwritten student name exactly as you read it (e.g. 'A. Boateng').",
    "- studentId: your best-guess id from this class roster (format `id: name`), or null if",
    "  you are not confident which student it is. Do NOT guess a student when the name is",
    "  abbreviated and could match more than one — return null and let the teacher confirm.",
    list,
    "",
    "For each of the five cells give:",
    "- value: the number you read, or null if the cell is blank, crossed out, or unreadable.",
    "  Do NOT guess — null is correct for unreadable.",
    "- confidence: your confidence in that value from 0 to 1 (use a low value, e.g. below 0.6,",
    "  whenever the digit is smudged, ambiguous, or inferred).",
  ].join("\n");
}

interface ToolUseBlock {
  type: string;
  name?: string;
  input?: unknown;
}
interface MessagesResponse {
  content?: ToolUseBlock[];
  stop_reason?: string;
  error?: { message?: string };
}

export class ClaudeLedgerExtractor implements LedgerExtractor {
  constructor(private readonly apiKey: string) {}

  async extract(input: ExtractInput): Promise<ScanExtraction> {
    const { mediaType, data } = parseDataUrl(input.imageDataUrl);

    const res = await fetch(MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        tools: [
          {
            name: TOOL_NAME,
            description:
              "Record the extracted five-category score grid, one entry per handwritten row.",
            input_schema: EXTRACTION_SCHEMA,
          },
        ],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data } },
              { type: "text", text: buildPrompt(input.roster) },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as MessagesResponse | null;
      // Never echo the request (it carries the image) — only the vendor's error text.
      throw new Error(
        `Ledger extract: Claude request failed (HTTP ${res.status}${
          body?.error?.message ? `: ${body.error.message}` : ""
        })`,
      );
    }

    const payload = (await res.json()) as MessagesResponse;
    if (payload.stop_reason === "refusal") {
      throw new Error("Ledger extract: request was declined by the model");
    }

    // Forced tool_choice → the grid arrives as the tool_use block's already-parsed `input`.
    const block = (payload.content ?? []).find(
      (b) => b.type === "tool_use" && b.name === TOOL_NAME,
    );
    const parsed = block?.input as ScanExtraction | undefined;
    if (!parsed || !Array.isArray(parsed.rows)) {
      throw new Error("Ledger extract: model returned no grid");
    }
    return parsed;
  }
}
