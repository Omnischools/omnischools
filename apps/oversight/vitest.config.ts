import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  /**
   * JSX through the AUTOMATIC runtime, so a `.tsx` module can be imported by a test.
   *
   * `tsconfig.json` sets `"jsx": "preserve"` — correct, because Next does the JSX transform itself and
   * never asks tsc to. esbuild (which is what vitest transforms with) therefore falls back to its own
   * default, the CLASSIC runtime, and emits bare `React.createElement` calls into a module that does
   * not import React — so importing any `.tsx` file in a test fails at call time with
   * "ReferenceError: React is not defined". Naming the automatic runtime here matches what the app is
   * actually built with and makes presentational `.tsx` modules unit-testable.
   */
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global-setup.ts"],
    setupFiles: ["tests/setup/env.ts"],
    // The gate's guarantees are about ORDER (audit before fetch) against ONE shared analytics DB.
    // Parallel files would interleave audit rows and make "no row was written" unprovable, so the
    // suite runs single-file. It is fast enough that this costs nothing.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
