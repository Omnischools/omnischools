/**
 * prod-schema-diff — find every place a target DB (prod) has drifted from the migration chain, in
 * one pass, instead of discovering gaps one failed paste at a time.
 *
 * WHY. Prod's schema is hand-maintained (RLS + tenant tables pasted by hand; `db:push`/`db:migrate`
 * never run against prod). Pasting 0058 failed on `column house.hm_user_id does not exist` — migration
 * 0044's column-add had never reached prod, and it turned out four more boarding columns + the
 * `house_gender` enum type were missing the same way. This surfaces the rest in one read-only pass.
 *
 * THE REFERENCE is Drizzle's own latest snapshot (`db/migrations/meta/<head>_snapshot.json`), NOT dev
 * — dev carries its own drift. The snapshot is the materialised "what the migrations produce".
 *
 * TWO MATCHING RULES, both learned the hard way against real prod drift:
 *
 *   • CONSTRAINTS ARE MATCHED STRUCTURALLY, NOT BY NAME. Prod names its composite tenant FKs
 *     `<table>_<col>_tenant_fk`; the migrations name them `<table>_school_id_<col>_<reftable>_..._fk`.
 *     Same constraint, different name — a by-name diff reported 54 present FKs as "missing". So FKs,
 *     uniques and PKs are compared by (table, columns[, referenced-table]) — immune to naming. CHECK
 *     constraints have no structural key (their expression), so they alone are matched by name.
 *
 *   • A MISSING ENUM TYPE IS A GAP, not a silent skip. `house_gender` was absent from prod (its column
 *     was never pasted, so the type was never created) — yet `house` is a present table. An earlier
 *     version `continue`d past any wholly-absent enum on the assumption it "rides with an absent
 *     table"; that is false when a PRESENT table has a (missing) column of that type. So an enum type
 *     absent from prod but referenced by a column on a staged table is reported 🔴.
 *
 * SCOPE. Prod is staged incrementally, so a snapshot object simply *absent* from prod is usually
 * intentional (a tier not yet launched). The ACTIONABLE signal is the class that breaks a paste: a
 * table that IS on prod, missing a column / constraint / enum-type the snapshot says it should have.
 * The report partitions accordingly so intentional staging never drowns a real gap.
 *
 * STRICTLY READ-ONLY — only SELECTs against information_schema / pg_catalog. Safe to point at prod.
 * It does NOT cover RLS policies (Drizzle doesn't own them; they live in db/sql/policies.sql and are
 * verified by db/sql/verify-prod-rls.sql). This is structural schema only.
 *
 * RUN:  PROD_DATABASE_URL="postgresql://…prod…" pnpm db:prod-schema-diff
 *       (falls back to DATABASE_URL; prints the host it hit so you always know which DB you diffed.)
 * EXIT: non-zero iff a STAGED table has a missing column / constraint / enum-type — an actionable gap.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const META = join(process.cwd(), "db", "migrations", "meta");

// Head snapshot = highest NNNN_snapshot.json. Not hardcoded — the next migration must not make this stale.
function loadHeadSnapshot(): { file: string; snap: SnapshotShape } {
  const files = readdirSync(META).filter((f) => /^\d+_snapshot\.json$/.test(f));
  if (files.length === 0) throw new Error(`no *_snapshot.json under ${META}`);
  files.sort((a, b) => parseInt(a) - parseInt(b));
  const file = files[files.length - 1];
  return { file, snap: JSON.parse(readFileSync(join(META, file), "utf8")) };
}

interface SnapCol {
  name: string;
  type: string;
  notNull: boolean;
}
interface SnapFk {
  columnsFrom: string[];
  tableTo: string;
}
interface SnapUnique {
  columns: string[];
}
interface SnapTable {
  columns: Record<string, SnapCol>;
  foreignKeys: Record<string, SnapFk>;
  uniqueConstraints: Record<string, SnapUnique>;
  checkConstraints: Record<string, unknown>;
  compositePrimaryKeys: Record<string, { columns: string[] }>;
}
interface SnapshotShape {
  tables: Record<string, SnapTable>;
  enums: Record<string, { name: string; values: string[] }>;
}

const bare = (s: string) => s.replace(/^public\./, "");

async function main() {
  const url = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Set PROD_DATABASE_URL (or DATABASE_URL) to the target database.");
    process.exit(2);
  }
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "(unparseable url)";
    }
  })();

  const { file, snap } = loadHeadSnapshot();
  const sql = postgres(url, { max: 1, prepare: false });

  try {
    // --- introspect the target (read-only) ---
    // ordered constraint columns, so a composite key's column ORDER is part of its signature.
    const CONCOLS = `(select string_agg(a.attname, ',' order by k.ord)
       from unnest(con.conkey) with ordinality k(attnum, ord)
       join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum)`;
    const cols = await sql<{ table_name: string; column_name: string; udt_name: string }[]>`
      SELECT table_name, column_name, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name <> '__drizzle_migrations'`;
    const fkRows = await sql<{ tbl: string; cols: string; reftbl: string }[]>`
      SELECT r.relname AS tbl, ${sql.unsafe(CONCOLS)} AS cols, cr.relname AS reftbl
      FROM pg_constraint con
      JOIN pg_class r ON r.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace AND n.nspname = 'public'
      JOIN pg_class cr ON cr.oid = con.confrelid
      WHERE con.contype = 'f'`;
    const uqRows = await sql<{ tbl: string; cols: string }[]>`
      SELECT r.relname AS tbl, ${sql.unsafe(CONCOLS)} AS cols
      FROM pg_constraint con
      JOIN pg_class r ON r.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace AND n.nspname = 'public'
      WHERE con.contype = 'u'`;
    const pkRows = await sql<{ tbl: string; cols: string }[]>`
      SELECT r.relname AS tbl, ${sql.unsafe(CONCOLS)} AS cols
      FROM pg_constraint con
      JOIN pg_class r ON r.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace AND n.nspname = 'public'
      WHERE con.contype = 'p'`;
    const checkRows = await sql<{ tbl: string; conname: string }[]>`
      SELECT r.relname AS tbl, con.conname
      FROM pg_constraint con
      JOIN pg_class r ON r.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace AND n.nspname = 'public'
      WHERE con.contype = 'c'`;
    const enumRows = await sql<{ enum: string; label: string }[]>`
      SELECT t.typname AS enum, e.enumlabel AS label
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'`;

    // --- shape the target into lookups ---
    const prodCols = new Map<string, Set<string>>();
    for (const c of cols) {
      if (!prodCols.has(c.table_name)) prodCols.set(c.table_name, new Set());
      prodCols.get(c.table_name)!.add(c.column_name);
    }
    const prodFk = new Set(fkRows.map((r) => `${r.tbl}|${r.cols}|${r.reftbl}`));
    const prodUq = new Set(uqRows.map((r) => `${r.tbl}|${r.cols}`));
    const prodPk = new Set(pkRows.map((r) => `${r.tbl}|${r.cols}`));
    const prodChecks = new Map<string, Set<string>>();
    for (const c of checkRows) {
      if (!prodChecks.has(c.tbl)) prodChecks.set(c.tbl, new Set());
      prodChecks.get(c.tbl)!.add(c.conname);
    }
    const prodEnums = new Map<string, Set<string>>();
    for (const r of enumRows) {
      if (!prodEnums.has(r.enum)) prodEnums.set(r.enum, new Set());
      prodEnums.get(r.enum)!.add(r.label);
    }

    // --- what the snapshot expects (enum names, and where each is used) ---
    const snapEnumNames = new Set(Object.keys(snap.enums).map((k) => bare(snap.enums[k].name)));
    // enumName -> the staged (present-on-prod) tables that have a column of that enum type
    const enumUsedByStaged = new Map<string, string[]>();
    for (const [key, t] of Object.entries(snap.tables)) {
      const tbl = bare(key);
      if (!prodCols.has(tbl)) continue; // not staged
      for (const c of Object.values(t.columns)) {
        if (snapEnumNames.has(c.type)) {
          if (!enumUsedByStaged.has(c.type)) enumUsedByStaged.set(c.type, []);
          enumUsedByStaged.get(c.type)!.push(`${tbl}.${c.name}`);
        }
      }
    }

    // --- diff ---
    const gaps: string[] = []; // 🔴 present-on-prod table missing a column/constraint/enum-type
    const notStaged: string[] = []; // 🟡 snapshot object absent on prod (usually intentional)

    for (const [key, t] of Object.entries(snap.tables)) {
      const tbl = bare(key);
      const pc = prodCols.get(tbl);
      if (!pc) {
        notStaged.push(`table ${tbl}`);
        continue;
      }
      for (const col of Object.values(t.columns)) {
        if (!pc.has(col.name))
          gaps.push(`  ${tbl}.${col.name}  — MISSING column (${col.type}${col.notNull ? " NOT NULL" : ""})`);
      }
      for (const fk of Object.values(t.foreignKeys ?? {})) {
        const sig = `${tbl}|${fk.columnsFrom.join(",")}|${bare(fk.tableTo)}`;
        if (!prodFk.has(sig)) gaps.push(`  ${tbl}  — MISSING foreign key (${fk.columnsFrom.join(",")} → ${bare(fk.tableTo)})`);
      }
      for (const u of Object.values(t.uniqueConstraints ?? {})) {
        const sig = `${tbl}|${u.columns.join(",")}`;
        if (!prodUq.has(sig)) gaps.push(`  ${tbl}  — MISSING unique (${u.columns.join(",")})`);
      }
      for (const pk of Object.values(t.compositePrimaryKeys ?? {})) {
        const sig = `${tbl}|${pk.columns.join(",")}`;
        if (!prodPk.has(sig)) gaps.push(`  ${tbl}  — MISSING primary key (${pk.columns.join(",")})`);
      }
      // CHECK constraints have no structural key — matched by name (with the 63-byte truncation fallback).
      const pk = prodChecks.get(tbl) ?? new Set<string>();
      for (const name of Object.keys(t.checkConstraints ?? {})) {
        if (!pk.has(name) && !pk.has(name.slice(0, 63))) gaps.push(`  ${tbl}  — MISSING check "${name}"`);
      }
    }

    // enum types & values
    for (const key of Object.keys(snap.enums)) {
      const e = snap.enums[key];
      const name = bare(e.name);
      const pe = prodEnums.get(name);
      if (!pe) {
        const users = enumUsedByStaged.get(name);
        if (users && users.length)
          gaps.push(`  enum type ${name}  — MISSING (needed by ${users.join(", ")})`);
        else notStaged.push(`enum ${name}`);
        continue;
      }
      const missing = e.values.filter((v) => !pe.has(v));
      if (missing.length) gaps.push(`  enum ${name}  — MISSING values: ${missing.join(", ")}`);
    }

    // reverse drift: prod object absent from the snapshot
    const snapTables = new Set(Object.keys(snap.tables).map(bare));
    const unexpected: string[] = [];
    for (const [tbl, cset] of prodCols) {
      if (!snapTables.has(tbl)) {
        unexpected.push(`  table ${tbl}  — on prod, not in the snapshot`);
        continue;
      }
      const snapColNames = new Set(Object.values(snap.tables[`public.${tbl}`].columns).map((c) => c.name));
      for (const c of cset) if (!snapColNames.has(c)) unexpected.push(`  ${tbl}.${c}  — on prod, not in the snapshot`);
    }

    // --- report ---
    const line = "─".repeat(78);
    console.log(`\nprod-schema-diff  ·  reference: ${file}  ·  target host: ${host}`);
    console.log(`${prodCols.size} tables on target · ${Object.keys(snap.tables).length} in snapshot\n`);

    console.log(line);
    console.log("🔴 GAPS ON STAGED TABLES — a table present on the target is missing a column,");
    console.log("   constraint, or enum-type the migrations produce. THIS is the class that breaks a paste.");
    console.log(line);
    console.log(gaps.length ? gaps.sort().join("\n") : "  (none — every staged table is complete)");

    console.log(`\n${line}`);
    console.log(`🟢 NOT YET STAGED — ${notStaged.length} snapshot objects absent from the target.`);
    console.log("   Usually intentional (a tier not yet launched on prod). Informational only.");
    console.log(line);
    console.log(notStaged.length ? "  " + notStaged.sort().join(", ") : "  (none — target has everything)");

    console.log(`\n${line}`);
    console.log("🟠 UNEXPECTED ON TARGET — objects on the target the snapshot has never heard of");
    console.log("   (reverse drift; a stale hand-add, or a table dropped from the schema).");
    console.log(line);
    console.log(unexpected.length ? unexpected.sort().join("\n") : "  (none)");

    console.log("");
    if (gaps.length) {
      console.log(`✗ ${gaps.length} actionable gap(s) on staged tables — bring the target up to the`);
      console.log("  migration that introduced each, then re-diff.\n");
      process.exit(1);
    }
    console.log("✓ No gaps on staged tables. (Review 🟠 above if present.)\n");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("✗ prod-schema-diff failed:", err);
  process.exit(2);
});
