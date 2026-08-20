import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { VLC_VALUES } from "./defaults";

/**
 * Issue #296 · VLC curriculum-library change request — SCHEMA slice guards. Static source checks (the
 * vlc-capstone.test.ts idiom): the migration's ordinal-keyed backfill stays byte-in-lockstep with the
 * frozen VLC_VALUES (the one drift that would silently mis-render a live row after the reader switches to
 * the stored columns), and the schema + prod-paste carry the agreed shape. Behavioral live-DB RLS is
 * Quinn/Sarah's gate (verified on dev at author time).
 */
const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
const migration = src("db/migrations/0085_rainy_ironclad.sql");
const schema = src("db/schema/vlc.ts");
const prodPaste = src("db/sql/prod-paste-0090-vlc-value-change-request.sql");

// ── #296-1 · the backfill is byte-in-lockstep with the frozen lib (descriptor + capstone by ordinal) ──
describe("#296-1 · migration 0085 backfills descriptor + is_capstone from VLC_VALUES, by ordinal", () => {
  it("every VLC_VALUES (ordinal, descriptor, capstone) triple appears in the backfill VALUES", () => {
    for (const v of VLC_VALUES) {
      const esc = v.descriptor.replace(/'/g, "''");
      const row = `(${v.ordinal}, '${esc}', ${v.capstone})`;
      expect(migration, `backfill row for ordinal ${v.ordinal} (${v.nameEn}) drifted`).toContain(row);
    }
  });
  it("backfills all 11 canonical values and no phantom extras (one row per VLC_VALUES entry)", () => {
    const rows = migration.match(/\(\d+, '[^\n]*', (?:true|false)\)/g) ?? [];
    expect(rows.length).toBe(VLC_VALUES.length);
  });
  it("exactly one capstone (ordinal 11, Wisdom) flips is_capstone true", () => {
    expect((migration.match(/, true\)/g) ?? []).length).toBe(1);
    expect(migration).toContain("(11, 'capstone · integration', true)");
  });
  it("the backfill runs AFTER the two ADD COLUMN statements", () => {
    const addCol = migration.indexOf('ADD COLUMN "is_capstone"');
    const update = migration.indexOf('UPDATE "vlc_value" v SET');
    expect(addCol).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(addCol);
  });
});

// ── #296-2 · schema shape — the two stored columns + the LEAF change-request table ──────────────────
describe("#296-2 · vlc.ts carries the stored columns and the change-request table", () => {
  it("vlc_value gains descriptor (nullable) + is_capstone (NOT NULL default false)", () => {
    expect(schema).toMatch(/descriptor: text\("descriptor"\)/);
    expect(schema).toMatch(/isCapstone: boolean\("is_capstone"\)\.notNull\(\)\.default\(false\)/);
  });
  it("vlc_value_change_request has op/state CHECK allow-lists and a schema-free jsonb payload", () => {
    expect(schema).toContain('export const vlcValueChangeRequest = pgTable(');
    expect(schema).toMatch(/payload: jsonb\("payload"\)\.notNull\(\)/);
    expect(schema).toMatch(/op.*IN \('ADD', 'REORDER', 'REMOVE'\)/);
    expect(schema).toMatch(/state.*IN \('PROPOSED', 'APPROVED', 'REJECTED'\)/);
  });
  it("state defaults to PROPOSED and the actor stamps are single-column SET NULL to ref_user", () => {
    expect(schema).toMatch(/state: text\("state"\)\.notNull\(\)\.default\("PROPOSED"\)/);
    expect((schema.match(/references\(\(\) => users\.id, \{\s*onDelete: "set null",\s*\}\)/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });
  it("no composite tenant FK / tenant_uk on the change-request table (LEAF, payload-id refs only)", () => {
    const block = schema.slice(schema.indexOf("export const vlcValueChangeRequest"));
    expect(block).not.toContain("tenant_uk");
    expect(block).not.toContain("foreignColumns");
  });
});

// ── #296-3 · prod-paste carries the RLS the dev-only db:policies misses on prod ─────────────────────
describe("#296-3 · prod-paste-0090 applies ENABLE+FORCE+tenant_isolation+parent_deny (leak-critical)", () => {
  it("FORCE RLS + tenant_isolation + the catalog-driven parent_deny loop are all present", () => {
    expect(prodPaste).toContain("FORCE ROW LEVEL SECURITY");
    expect(prodPaste).toContain("CREATE POLICY tenant_isolation");
    expect(prodPaste).toContain("CREATE POLICY parent_deny");
    expect(prodPaste).toContain("AS RESTRICTIVE");
  });
  it("carries the same idempotent backfill as the migration (self-contained rebuild-equivalent)", () => {
    expect(prodPaste).toContain("ADD COLUMN IF NOT EXISTS \"descriptor\"");
    expect(prodPaste).toContain("(11, 'capstone · integration', true)");
  });
  it("db:policies tenant array lists the new table so dev gets tenant_isolation too", () => {
    expect(src("db/sql/policies.sql")).toContain("'vlc_value_change_request'");
  });
});
