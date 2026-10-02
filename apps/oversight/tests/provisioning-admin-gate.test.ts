import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFICER } from "./fixtures/ids";

/**
 * THE ADMIN CONSOLE'S ROLE GATE, and the isolation of the provisioner credential
 * (Kofi R7 · Lucy G8/R10).
 *
 * Two properties, each with a specific failure in mind:
 *
 *  1. A GES OFFICER — ANY TIER — IS REFUSED. The tempting shortcut is "national officers are the
 *     most senior people, let them provision". That would make the most privileged READER of named
 *     records the person who decides who may read them, collapsing the separation the whole officer
 *     directory rests on (the app credential cannot write the directory; neither may its most
 *     powerful user). The test asserts the refusal POSITIVELY, including for a uid that is also on
 *     the admin allow-list.
 *  2. THE PROVISIONER CONNECTION IS UNREACHABLE FROM THE OFFICER-FACING APP. Same shape as
 *     tests/readback-isolation.test.ts: a direct-import allow-list plus transitive reachability from
 *     every App-Router entry point. A page under `(oversight)` that could import
 *     `lib/provisioning/db` would be a page that can write authority.
 */

const SUPABASE_MODULE = "@/lib/supabase/server";
const ADMIN_UID = "90000000-0000-4000-8000-00000000000a";

async function adminAuthWith(opts: {
  uid: string | null;
  allowList: string;
  configured?: boolean;
}) {
  vi.resetModules();
  vi.stubEnv("OVERSIGHT_ADMIN_UIDS", opts.allowList);
  vi.stubEnv("AUTH_DEV_BYPASS", "false");
  if (opts.configured === false) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  } else {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://analytics.example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-test");
  }

  vi.doMock(SUPABASE_MODULE, () => ({
    createClient: async () => ({
      auth: {
        getUser: async () =>
          opts.uid
            ? {
                data: {
                  user: { id: opts.uid, email: "ops@omnischools.gh", user_metadata: {} },
                },
                error: null,
              }
            : { data: { user: null }, error: null },
      },
    }),
  }));

  return import("@/lib/provisioning/admin-auth");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock(SUPABASE_MODULE);
  vi.resetModules();
});

describe("the admin allow-list", () => {
  it("admits an Omnischools uid that is on the list and is NOT a GES officer", async () => {
    const mod = await adminAuthWith({ uid: ADMIN_UID, allowList: ADMIN_UID });
    const session = await mod.getAdminSession();
    expect(session?.adminId).toBe(ADMIN_UID);
  });

  it("refuses a uid that is not on the list", async () => {
    const mod = await adminAuthWith({
      uid: "90000000-0000-4000-8000-00000000000b",
      allowList: ADMIN_UID,
    });
    expect(await mod.getAdminSession()).toBeNull();
  });

  it("refuses EVERYBODY when the list is unset — no bootstrap backdoor", async () => {
    const mod = await adminAuthWith({ uid: ADMIN_UID, allowList: "" });
    expect(await mod.getAdminSession()).toBeNull();
  });

  it("refuses when Supabase auth is not configured at all", async () => {
    const mod = await adminAuthWith({
      uid: ADMIN_UID,
      allowList: ADMIN_UID,
      configured: false,
    });
    expect(await mod.getAdminSession()).toBeNull();
  });

  it("tolerates whitespace and case in the list, because an env var is typed by a human", async () => {
    const mod = await adminAuthWith({
      uid: ADMIN_UID.toUpperCase(),
      allowList: `  ${ADMIN_UID} , 90000000-0000-4000-8000-00000000000c `,
    });
    expect((await mod.getAdminSession())?.adminId).toBe(ADMIN_UID.toUpperCase());
  });
});

describe("a GES officer session is refused — at EVERY tier", () => {
  it("refuses a DISTRICT officer even if their uid is on the admin allow-list", async () => {
    const mod = await adminAuthWith({
      uid: OFFICER.districtId,
      allowList: `${ADMIN_UID},${OFFICER.districtId}`,
    });
    expect(await mod.getAdminSession()).toBeNull();
  });

  it("refuses a REGION officer even if their uid is on the admin allow-list", async () => {
    // The middle tier was the one this block's title claimed and did not test. A regional director
    // is the officer most plausibly mistaken for "senior enough to administer the console".
    const mod = await adminAuthWith({
      uid: OFFICER.regionId,
      allowList: `${ADMIN_UID},${OFFICER.regionId}`,
    });
    expect(await mod.getAdminSession()).toBeNull();
  });

  it("refuses a NATIONAL officer even if their uid is on the admin allow-list", async () => {
    // The important case. Seniority inside GES is not provisioning authority.
    const mod = await adminAuthWith({
      uid: OFFICER.nationalId,
      allowList: `${ADMIN_UID},${OFFICER.nationalId}`,
    });
    expect(await mod.getAdminSession()).toBeNull();
  });

  it("requireAdminSession throws AdminAccessDeniedError, with a message that reveals nothing", async () => {
    const mod = await adminAuthWith({
      uid: OFFICER.nationalId,
      allowList: OFFICER.nationalId,
    });
    const error = await mod.requireAdminSession().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(mod.AdminAccessDeniedError);
    // It must not say "because you are an officer" or "because you are not on the list" — the
    // console is not an oracle for who administers it.
    expect(String((error as Error).message)).not.toMatch(/officer|allow-list|list/i);
  });
});

// ─── the provisioner credential is isolated ─────────────────────────────────────────────────────

const ROOT = process.cwd();
const rel = (f: string): string => relative(ROOT, f).replaceAll("\\", "/");

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const SOURCES = ["lib", "app", "components"].flatMap((d) => walk(join(ROOT, d)));

function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  const re = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) specs.push(m[1]!);
  return specs;
}

function isProvisionerSpecifier(spec: string): boolean {
  return /(^|\/)lib\/provisioning\/db$/.test(spec) || spec === "@/lib/provisioning/db";
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* not this one */
    }
  }
  return null;
}

function reachesProvisioner(entry: string, seen = new Set<string>()): boolean {
  if (seen.has(entry)) return false;
  seen.add(entry);
  for (const spec of importSpecifiers(entry)) {
    if (isProvisionerSpecifier(spec)) return true;
    const resolved = resolveSpecifier(entry, spec);
    if (resolved && reachesProvisioner(resolved, seen)) return true;
  }
  return false;
}

describe("no officer-facing code may import the provisioner connection", () => {
  it("direct importers match the allow-list exactly", () => {
    const importers = SOURCES.filter(
      (f) =>
        rel(f) !== "lib/provisioning/db.ts" &&
        importSpecifiers(f).some(isProvisionerSpecifier),
    )
      .map(rel)
      .sort();
    expect(importers).toEqual([
      "app/(admin)/admin/officers/actions.ts",
      "app/(admin)/admin/officers/approvals/page.tsx",
      "app/(admin)/admin/officers/page.tsx",
      "app/(admin)/admin/officers/provision/page.tsx",
    ]);
  });

  it("NO entry point under (oversight) reaches it, even transitively", () => {
    const officerEntries = SOURCES.filter(
      (f) =>
        rel(f).startsWith("app/(oversight)") &&
        /(page|layout|route|actions)\.(ts|tsx)$/.test(rel(f)),
    );
    expect(officerEntries.length).toBeGreaterThan(0);
    const offenders = officerEntries
      .map(rel)
      .filter((r) => reachesProvisioner(join(ROOT, r)));
    expect(offenders).toEqual([]);
  });

  it("the officer-facing sign-in surfaces do not reach it either", () => {
    for (const entry of [
      "app/sign-in/page.tsx",
      "app/sign-in/actions.ts",
      "app/(oversight)/page.tsx", // the landing (moved into the group in G — see that file's note)
    ]) {
      expect(reachesProvisioner(join(ROOT, entry)), entry).toBe(false);
    }
  });

  it("lib/provisioning/db.ts never mentions the app's analytics URL", () => {
    // The same discipline as lib/db/readback.ts: no fallback, and no way to acquire one by accident.
    const source = readFileSync(join(ROOT, "lib/provisioning/db.ts"), "utf8");
    expect(source).not.toMatch(/ANALYTICS_DATABASE_URL(?!`)/);
  });
});
