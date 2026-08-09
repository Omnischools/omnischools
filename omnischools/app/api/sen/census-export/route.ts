import { requireSchoolRole } from "@/lib/auth/server";
import { SEN_REGISTER_ROLES } from "@/lib/access";
import { getCensusSpecialNeeds, SEN_CATEGORIES } from "@/lib/reports/census/sen-data";
import { SEN_CATEGORY_LABEL } from "@/lib/sen/vocab";

/**
 * GOV-10 · "Export anonymised stats" — the DE-IDENTIFIED 12-cell aggregate (category × sex counts) as CSV.
 * Admin-gated (SEN_REGISTER_ROLES). Structurally carries NO name / id / severity / diagnosis — it is exactly
 * the same shape that auto-fills the census §5, so what leaves the school's instance is counts only. Served
 * from `app/api/*` (the repo's download-route convention — receipts / report-cards / ledger-book), NOT from
 * under the page tree (which the `no-html-link-for-pages` rule would flag).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { school } = await requireSchoolRole(SEN_REGISTER_ROLES);
  const sn = await getCensusSpecialNeeds(school.id);

  let boys = 0;
  let girls = 0;
  const lines = ["category,boys,girls"];
  for (const c of SEN_CATEGORIES) {
    const cell = sn.byCategory[c];
    boys += cell.male;
    girls += cell.female;
    lines.push(`${SEN_CATEGORY_LABEL[c]},${cell.male},${cell.female}`);
  }
  lines.push(`Total,${boys},${girls}`);

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sen-census-aggregate.csv"',
    },
  });
}
