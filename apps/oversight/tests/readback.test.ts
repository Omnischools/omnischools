import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Kofi group A — the read-back is a SECOND, isolated client that fails closed.
 *
 * Every test here re-imports the module under `vi.resetModules()`, because `lib/env.ts` parses
 * `process.env` once at import time. Stubbing the variable without resetting would test the env
 * from the last import, which is the failure mode that makes "we set the flag" tests lie.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function importReadback(readbackUrl: string | undefined) {
  vi.resetModules();
  if (readbackUrl === undefined) {
    vi.stubEnv("OPERATIONAL_READBACK_URL", "");
  } else {
    vi.stubEnv("OPERATIONAL_READBACK_URL", readbackUrl);
  }
  return import("@/lib/db/readback");
}

describe("fail closed when OPERATIONAL_READBACK_URL is unset", () => {
  it("reports itself unconfigured rather than guessing", async () => {
    const mod = await importReadback(undefined);
    expect(mod.isReadbackConfigured()).toBe(false);
  });

  it("throws ReadbackUnavailableError from getReadbackClient", async () => {
    const mod = await importReadback(undefined);
    expect(() => mod.getReadbackClient()).toThrowError(mod.ReadbackUnavailableError);
  });

  it("throws from withReadbackSchool — no partial record, no empty result", async () => {
    const mod = await importReadback(undefined);
    await expect(
      mod.withReadbackSchool("30000000-0000-4000-8000-000000000001", async () => "never"),
    ).rejects.toBeInstanceOf(mod.ReadbackUnavailableError);
  });

  it("treats a blank string as unset (a half-configured deployment is unconfigured)", async () => {
    const mod = await importReadback("   ");
    expect(mod.isReadbackConfigured()).toBe(false);
  });

  it("NEVER falls back to ANALYTICS_DATABASE_URL — the source text cannot mention it", () => {
    const source = readFileSync(join(process.cwd(), "lib/db/readback.ts"), "utf8");
    const code = source
      .split("\n")
      .filter(
        (line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"),
      )
      .join("\n");
    expect(code).not.toMatch(/ANALYTICS_DATABASE_URL/);
  });

  it("does not import the analytics client or drizzle schema", () => {
    const source = readFileSync(join(process.cwd(), "lib/db/readback.ts"), "utf8");
    expect(source).not.toMatch(/from ["']@\/lib\/db["']/);
    expect(source).not.toMatch(/from ["']@\/db\/schema/);
  });
});

describe("the configured client is scoped and time-limited", () => {
  it("applies statement_timeout, idle-in-transaction timeout and read-only at connection level", async () => {
    const mod = await importReadback(process.env.OPERATIONAL_READBACK_URL);
    const sql = mod.getReadbackClient();
    const rows = (await sql`
      select current_setting('statement_timeout') as st,
             current_setting('idle_in_transaction_session_timeout') as idle,
             current_setting('default_transaction_read_only') as ro
    `) as unknown as { st: string; idle: string; ro: string }[];
    expect(rows[0]!.st).toBe("5s");
    expect(rows[0]!.idle).toBe("10s");
    expect(rows[0]!.ro).toBe("on");
    await mod.closeReadback();
  });

  it("sets app.current_school inside the transaction, and only there", async () => {
    const mod = await importReadback(process.env.OPERATIONAL_READBACK_URL);
    const inside = await mod.withReadbackSchool(
      "30000000-0000-4000-8000-000000000001",
      async (tx) => {
        const rows =
          (await tx`select current_setting('app.current_school', true) as s`) as unknown as {
            s: string;
          }[];
        return rows[0]!.s;
      },
    );
    expect(inside).toBe("30000000-0000-4000-8000-000000000001");

    const after =
      (await mod.getReadbackClient()`select current_setting('app.current_school', true) as s`) as unknown as {
        s: string | null;
      }[];
    expect(after[0]!.s ?? "").toBe("");
    await mod.closeReadback();
  });

  it("is refused SELECT on staff_compensation by the database role itself", async () => {
    const mod = await importReadback(process.env.OPERATIONAL_READBACK_URL);
    await expect(
      mod.withReadbackSchool("30000000-0000-4000-8000-000000000001", async (tx) => {
        return tx`select monthly_amount from staff_compensation limit 1`;
      }),
    ).rejects.toThrowError(/permission denied/i);
    await mod.closeReadback();
  });

  it("cannot write to operational data even if code tried to", async () => {
    const mod = await importReadback(process.env.OPERATIONAL_READBACK_URL);
    await expect(
      mod.withReadbackSchool("30000000-0000-4000-8000-000000000001", async (tx) => {
        return tx`update staff_profile set gender = 'X' where true`;
      }),
    ).rejects.toThrowError(/read-only|permission denied/i);
    await mod.closeReadback();
  });
});
