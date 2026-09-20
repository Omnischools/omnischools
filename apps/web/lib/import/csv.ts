/**
 * Tiny dependency-free CSV layer shared by the import flows (students, staff).
 * Pure + client-safe (no DOM, no DB).
 */

/** Parse CSV text into rows of string cells (handles quotes, commas, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\r") {
      // ignore — handled by \n
    } else if (c === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  // drop fully-blank rows
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Build a CSV string (header row + optional sample rows) for a download template. */
export function csvTemplate(headers: string[], samples: string[][] = []): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers, ...samples].map((r) => r.map(esc).join(",")).join("\n");
}

/** Normalise a Ghanaian phone to E.164 (+233…). Client-safe duplicate of lib/auth. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+233")) return digits;
  if (digits.startsWith("233")) return `+${digits}`;
  if (digits.startsWith("0")) return `+233${digits.slice(1)}`;
  if (/^\d{9}$/.test(digits)) return `+233${digits}`;
  return digits;
}

export function isValidGhanaPhone(input: string): boolean {
  return /^\+233\d{9}$/.test(normalizePhone(input));
}
