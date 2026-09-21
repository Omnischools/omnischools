import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
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
