import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests run in Node with the same `@/` path alias the app uses.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "features/**/*.test.ts"],
    environment: "node",
  },
  // tsconfig uses jsx: "preserve" (Next transforms it); Vite 8 transforms with oxc, which would
  // otherwise preserve JSX and break import-analysis. Pin the React 18 automatic runtime so the one
  // component render test (audit-feed-render.test.ts) can renderToStaticMarkup.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Next resolves `server-only` at build time; in the node test env it is unresolvable, so we
      // point it at a no-op to let server components render under renderToStaticMarkup (INCR-30).
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
});
