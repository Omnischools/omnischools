// Empty stand-in for the `server-only` build-time marker so the verify scripts can import
// server-only modules (lib/data/*, lib/pdf/render-*) under a plain `tsx` run. Next resolves
// the real no-op via the `react-server` export condition in-app; this stub is dev-tooling only,
// wired in exclusively through scripts/tsconfig.json (never the app's root tsconfig).
export {};
