import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import nextConfig from "@/next.config.mjs";

/**
 * The image optimiser must never accept an attacker-controlled host.
 *
 * `next.config.mjs` allowlisted `*.supabase.co`. That wildcard matches ANY Supabase project, not
 * just ours, and anyone can create a free one. Next fetches allowlisted remote URLs and transforms
 * them SERVER-SIDE through sharp/libvips, so `/_next/image?url=https://<attacker>.supabase.co/x.tif`
 * fed a crafted image straight into libvips — which carried four CVEs (CVE-2026-33327/33328/35590/
 * 35591, dependabot #36) via sharp@0.34.5. The wildcard is what made them reachable; the override is
 * what patches them. Both halves are asserted here because either one alone leaves a live path.
 *
 * Following this repo's existing security-test convention (see `lib/auth/app-shell-guard.test.ts`):
 *
 *  1. ASSERT THE CONSEQUENCE, NOT THE TEXT. Both assertions read PARSED data — the real config
 *     object Next receives, and the resolved lockfile — never `next.config.mjs` source. A source
 *     grep for "*.supabase.co" would FAIL on the explanatory comment now sitting in that file, and
 *     conversely would PASS a wildcard reintroduced under a different host. Text is the wrong layer.
 *  2. FORBID THE WILDCARD, NOT REMOTE IMAGES. If someone later genuinely needs a remote image, a
 *     hostname pinned to one project ref is fine and should not fail this test. Only `*` is fatal,
 *     so the invariant survives a legitimate future entry instead of being deleted to unblock one.
 */
describe("image optimiser cannot be pointed at an attacker's host", () => {
  it("allows no wildcard hostname in images.remotePatterns", () => {
    const patterns = nextConfig.images?.remotePatterns ?? [];
    // Currently empty: nothing renders a remote image through next/image (the school logo and
    // stamp use plain <img>), so the optimiser rejects every remote URL outright.
    expect(patterns).toEqual([]);
    for (const p of patterns) {
      expect(p.hostname, `remotePattern "${p.hostname}" is a wildcard host`).not.toContain("*");
    }
  });

  it("resolves every sharp in the lockfile to the patched >= 0.35.0", () => {
    const lock = readFileSync(resolve(cwd(), "pnpm-lock.yaml"), "utf8");
    // Matches concrete resolutions like `sharp@0.35.3:`; the `sharp@<0.35.0` override *selector*
    // has no digit after the `@` and is skipped, so this reads what actually installs.
    const versions = [...lock.matchAll(/\bsharp@(\d+)\.(\d+)\.(\d+)/g)];
    expect(versions.length, "no sharp resolution found in pnpm-lock.yaml").toBeGreaterThan(0);

    for (const [full, major, minor] of versions) {
      const [maj, min] = [Number(major), Number(minor)];
      // 0.35.0 is the first release carrying patched libvips prebuilts.
      expect(maj > 0 || min >= 35, `${full} is below the patched sharp 0.35.0`).toBe(true);
    }
  });
});
