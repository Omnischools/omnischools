import { sql } from "drizzle-orm";
import { withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";

/**
 * The officer's own jurisdiction node, read for CHROME ONLY (Lucy G2: the crest sub-line, the
 * "Your jurisdiction" scope chip, the acknowledgement copy).
 *
 * TWO PROPERTIES WORTH STATING:
 *
 *  1. IT GOES THROUGH `withJurisdiction()`. The name could have been taken from the resolver in one
 *     round trip, and was not: `ov_resolve_officer()` returns no names at all (Wells's note), and
 *     widening it so the shell could show a label would put a second, unscoped read path into the
 *     thing whose narrowness is the officer directory's whole design. This read is ordinary,
 *     RLS-filtered and uninteresting — an officer reading the name of their own node, which
 *     `ov_in_subtree()` already admits.
 *  2. IT IS NOT AUTHORITATIVE FOR ANYTHING. If it returns null (a node the policy filters away, a
 *     database hiccup) the caller falls back to a label. No tier, no ceiling and no gate decision
 *     reads this function — losing the name must degrade the chrome, never the boundary.
 */
export interface JurisdictionNode {
  jurisdictionId: string;
  name: string;
  level: string;
  parentName: string | null;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as Record<string, unknown>[];
}

export async function getJurisdictionNode(
  scope: JurisdictionScope,
  jurisdictionId: string | null,
): Promise<JurisdictionNode | null> {
  if (!jurisdictionId) return null;
  try {
    return await withJurisdiction(scope, async (tx) => {
      const result = await tx.execute(sql`
        select dj.jurisdiction_id::text as jurisdiction_id,
               dj.name                  as name,
               dj.level::text           as level,
               parent.name              as parent_name
          from dim_jurisdiction dj
          left join dim_jurisdiction parent on parent.jurisdiction_id = dj.parent_id
         where dj.jurisdiction_id = ${jurisdictionId}::uuid
         limit 1
      `);
      const row = rowsOf(result)[0];
      if (!row) return null;
      return {
        jurisdictionId: row.jurisdiction_id as string,
        name: row.name as string,
        level: row.level as string,
        parentName: (row.parent_name as string | null) ?? null,
      };
    });
  } catch {
    // Chrome only — see property 2. A failed label must not take the page down.
    return null;
  }
}
