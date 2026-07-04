import "server-only";
import { and, eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { whatsappTemplates } from "@/db/schema";
import type {
  Category,
  HeaderType,
  Language,
  TemplateButton,
  TemplateStatus,
} from "@/lib/whatsapp-templates";

export type LoadedTemplate = {
  id: string;
  name: string;
  category: Category;
  language: Language;
  headerType: HeaderType;
  headerText: string | null;
  headerFilename: string | null;
  body: string;
  footer: string | null;
  buttons: TemplateButton[];
  sampleValues: Record<string, string>;
  status: TemplateStatus;
  rejectionReason: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

/** Normalise the jsonb columns into typed arrays/records the UI can rely on. */
function normalizeButtons(raw: unknown): TemplateButton[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b): b is TemplateButton => !!b && typeof b === "object" && "type" in b)
    .map((b) => ({
      type: b.type,
      label: String(b.label ?? ""),
      value: b.value ? String(b.value) : "",
    }));
}

function normalizeSamples(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = String(v ?? "");
  }
  return out;
}

/** Load one template for the school (RLS-scoped). Returns null if not found. */
export async function loadTemplate(
  schoolId: string,
  id: string,
): Promise<LoadedTemplate | null> {
  const [row] = await withSchool(schoolId, (tx) =>
    tx
      .select()
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.schoolId, schoolId))),
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category as Category,
    language: row.language as Language,
    headerType: row.headerType as HeaderType,
    headerText: row.headerText,
    headerFilename: row.headerFilename,
    body: row.body,
    footer: row.footer,
    buttons: normalizeButtons(row.buttons),
    sampleValues: normalizeSamples(row.sampleValues),
    status: row.status as TemplateStatus,
    rejectionReason: row.rejectionReason,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
