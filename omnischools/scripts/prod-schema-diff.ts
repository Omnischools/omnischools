/**
 * prod-schema-diff — find every place a target DB (prod) has drifted from the migration chain, in
 * one pass, instead of discovering gaps one failed paste at a time.
 *
 * WHY. Prod's schema is hand-maintained (RLS + tenant tables pasted by hand; `db:push`/`db:migrate`
 * never run against prod). Pasting 0058 failed on `column house.hm_user_id does not exist` — migration
 * 0044's column-add had never reached prod. That is one gap; this surfaces the rest.
 *
 * THE REFERENCE is Drizzle's own latest snapshot (`db/migrations/meta/<head>_snapshot.json`), NOT dev
 * — dev carries its own drift (a missing `boarding_infractions` tenant UK, etc.), so dev is not a
 * clean "what the migrations produce". The snapshot is the materialised expected schema.
 *
 * SCOPE. Prod is staged incrementally, so a snapshot table simply *absent* from prod is usually
 * intentional (not-yet-launched tier), not a bug. The ACTIONABLE signal is the class that broke the
 * paste: a table that IS on prod, missing a column / constraint the snapshot says it should have. The
 * report partitions accordingly so intentional staging never drowns a real gap.
 *
 * STRICTLY READ-ONLY — only SELECTs against information_schema / pg_catalog. Safe to point at prod.
 * It does NOT cover RLS policies (Drizzle doesn't own them; they live in db/sql/policies.sql and are
 * verified by db/sql/verify-prod-rls.sql). This is structural schema only — the drift class that
 * breaks a paste.
 *
 * RUN:  PROD_DATABASE_URL="postgresql://…prod…" pnpm db:prod-schema-diff
 *       (falls back to DATABASE_URL; prints the host it hit so you always know which DB you diffed.)
 * EXIT: non-zero iff a STAGED table has a missing column/constraint — i.e. an actionable gap.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const META = join(process.cwd(), "db", "migrations", "meta");

// The head snapshot = highest NNNN_snapshot.json. Not hardcoded to 0058 — the next migration must not
// silently make this stale.
function loadHeadSnapshot(): { file: string; snap: SnapshotShape } {
  const files = readdirSync(META).filter((f) => /^\d+_snapshot\.json$/.test(f));
  if (files.length === 0) throw new Error(`no *_snapshot.json under ${META}`);
  files.sort((a, b) => parseInt(a) - parseInt(b));
  const file = files[files.length - 1];
  return { file, snap: JSON.parse(readFileSync(join(META, file), "utf8")) };
}

interface SnapCol { name: string; type: string; notNull: boolean }
interface SnapTable {
  name: string;
  columns: Record<string, SnapCol>;
  foreignKeys: Record<string, unknown>;
  uniqueConstraints: Record<string, unknown>;
  checkConstraints: Record<string, unknown>;
  compositePrimaryKeys: Record<string, unknown>;
}
interface SnapshotShape {
  tables: Record<string, SnapTable>;
  enums: Record<string, { name: string; values: string[] }>;
}

/**
 * Canonicalise a type so the snapshot's spelling and Postgres's `udt_name` compare equal. Only used
 * to flag a *mismatch*; when either side canonicalises to something we don't recognise, we stay
 * silent rather than cry wolf (a missing column is the exact, high-confidence signal — a fuzzy type
 * guess is not worth a false alarm).
 */
function canonType(t: string): string {
  const s = t.toLowerCase().trim();
  const map: Record<string, string> = {
    "timestamp with time zone": "timestamptz",
    "timestamp without time zone": "timestamp",
    "boolean": "bool",
    "integer": "int4",
    "smallint": "int2",
    "bigint": "int8",
    "double precision": "float8",
    "character varying": "varchar",
    "user-defined": "", // pg reports enums as data_type 'USER-DEFINED'; match on udt_name instead
  };
  if (map[s] !== undefined) return map[s];
  return s.replace(/\s*\(.*\)$/, "").replace(/\s+/g, ""); // numeric(12, 2) -> numeric
}

async function main() {
  const url = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Set PROD_DATABASE_URL (or DATABASE_URL) to the target database.");
    process.exit(2);
  }
  const host = (() => {
    try { return new URL(url).host; } catch { return "(unparseable url)"; }
  })();

  const { file, snap } = loadHeadSnapshot();
  const sql = postgres(url, { max: 1, prepare: false });

  try {
    // --- introspect the target (read-only) ---
    const cols = await sql<{ table_name: string; column_name: string; udt_name: string; is_nullable: string }[]>`
      SELECT table_name, column_name, udt_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'`;
    const cons = await sql<{ table: string; conname: string; contype: string }[]>`
      SELECT c.conrelid::regclass::text AS table, c.conname, c.contype
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public'`;
    const enumRows = await sql<{ enum: string; label: string }[]>`
      SELECT t.typname AS enum, e.enumlabel AS label
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder`;

    // --- shape the target into lookups ---
    const prodTables = new Map<string, Map<string, { udt: string; nullable: boolean }>>();
    for (const c of cols) {
      if (!prodTables.has(c.table_name)) prodTables.set(c.table_name, new Map());
      prodTables.get(c.table_name)!.set(c.column_name, {
        udt: c.udt_name.toLowerCase(),
        nullable: c.is_nullable === "YES",
      });
    }
    const prodCons = new Set(cons.map((c) => `${c.table}.${c.conname}`));
    const prodConsByTable = new Map<string, Set<string>>();
    for (const c of cons) {
      const key = c.table.replace(/^public\./, "");
      if (!prodConsByTable.has(key)) prodConsByTable.set(key, new Set());
      prodConsByTable.get(key)!.add(c.conname);
    }
    const prodEnums = new Map<string, Set<string>>();
    for (const r of enumRows) {
      if (!prodEnums.has(r.enum)) prodEnums.set(r.enum, new Set());
      prodEnums.get(r.enum)!.add(r.label);
    }

    // --- diff ---
    const staged: string[] = []; // 🔴 present-on-prod tables missing a column/constraint
    const typeMismatch: string[] = []; // 🟡 best-effort
    const notStaged: string[] = []; // 🟡 snapshot table absent on prod (usually intentional)
    const enumGaps: string[] = [];

    for (const [key, t] of Object.entries(snap.tables)) {
      const tableName = key.replace(/^public\./, "");
      const prodCols = prodTables.get(tableName);
      if (!prodCols) {
        notStaged.push(tableName);
        continue;
      }
      // columns
      for (const col of Object.values(t.columns)) {
        const pc = prodCols.get(col.name);
        if (!pc) {
          staged.push(`  ${tableName}.${col.name}  — MISSING column (${col.type}${col.notNull ? " NOT NULL" : ""})`);
          continue;
        }
        const want = canonType(col.type);
        const enumName = col.type.replace(/^public\./, "").toLowerCase();
        const got = pc.udt;
        // match either a base type OR the enum's udt_name
        const ok = want === "" ? prodEnums.has(enumName) && got === enumName : want === got || got === enumName;
        if (!ok && want !== "") {
          typeMismatch.push(`  ${tableName}.${col.name}  — snapshot ${col.type}  vs prod ${got}`);
        }
      }
      // constraints (name-level: a missing CHECK / UNIQUE / FK / PK is a real integrity gap)
      const pcSet = prodConsByTable.get(tableName) ?? new Set<string>();
      const wantCons = [
        ...Object.keys(t.checkConstraints ?? {}),
        ...Object.keys(t.uniqueConstraints ?? {}),
        ...Object.keys(t.foreignKeys ?? {}),
        ...Object.keys(t.compositePrimaryKeys ?? {}),
      ];
      for (const name of wantCons) {
        // Postgres truncates identifiers to 63 bytes, so a long composite-FK name in the snapshot is
        // stored clipped (`…students_school_id_id_fk` → `…students_school_id_i`). Match both forms, or
        // every long tenant FK reads as a false "missing".
        if (!pcSet.has(name) && !pcSet.has(name.slice(0, 63))) {
          staged.push(`  ${tableName}  — MISSING constraint "${name}"`);
        }
      }
    }

    // enum value gaps (only for enums that exist on prod — a wholly-absent enum rides with its table)
    for (const [key, e] of Object.entries(snap.enums)) {
      const name = e.name.replace(/^public\./, "");
      const pe = prodEnums.get(name);
      if (!pe) continue;
      const missing = e.values.filter((v) => !pe.has(v));
      if (missing.length) enumGaps.push(`  ${name}  — MISSING values: ${missing.join(", ")}`);
    }

    // reverse drift: prod table/column absent from the snapshot (worth an eyebrow, rarely a bug)
    const snapTableNames = new Set(Object.keys(snap.tables).map((k) => k.replace(/^public\./, "")));
    const unexpected: string[] = [];
    for (const [tbl] of prodTables) {
      if (tbl === "__drizzle_migrations") continue;
      if (!snapTableNames.has(tbl)) unexpected.push(`  ${tbl}  — on prod, not in the snapshot`);
    }

    // --- report ---
    const line = "─".repeat(78);
    console.log(`\nprod-schema-diff  ·  reference: ${file}  ·  target host: ${host}`);
    console.log(`${prodTables.size} tables on target · ${Object.keys(snap.tables).length} in snapshot\n`);

    console.log(line);
    console.log("🔴 STAGED TABLES WITH GAPS — a table present on the target is missing something the");
    console.log("   migrations produce. THIS is the class that breaks a paste. Fix before relying on it.");
    console.log(line);
    console.log(staged.length ? staged.sort().join("\n") : "  (none — every staged table is complete)");

    console.log(`\n${line}`);
    console.log("🟡 TYPE MISMATCH (best-effort — verify by hand; normalisation is imperfect)");
    console.log(line);
    console.log(typeMismatch.length ? typeMismatch.sort().join("\n") : "  (none)");

    console.log(`\n${line}`);
    console.log("🟡 ENUM VALUE GAPS (enum exists on target but is missing values)");
    console.log(line);
    console.log(enumGaps.length ? enumGaps.sort().join("\n") : "  (none)");

    console.log(`\n${line}`);
    console.log(`🟢 NOT YET STAGED — ${notStaged.length} snapshot tables absent from the target.`);
    console.log("   Usually intentional (a tier not yet launched on prod). Informational only.");
    console.log(line);
    console.log(notStaged.length ? "  " + notStaged.sort().join(", ") : "  (none — target has every table)");

    console.log(`\n${line}`);
    console.log("🟠 UNEXPECTED ON TARGET — objects on the target that the snapshot has never heard of");
    console.log("   (reverse drift; a stale hand-add, or a table dropped from the schema).");
    console.log(line);
    console.log(unexpected.length ? unexpected.sort().join("\n") : "  (none)");

    console.log("");
    if (staged.length) {
      console.log(`✗ ${staged.length} actionable gap(s) on staged tables — bring the target up to the`);
      console.log("  migration that introduced each, then re-diff.\n");
      process.exit(1);
    }
    console.log("✓ No gaps on staged tables. (Review 🟡/🟠 above if present.)\n");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("✗ prod-schema-diff failed:", err);
  process.exit(2);
});
