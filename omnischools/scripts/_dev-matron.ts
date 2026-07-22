/**
 * Pin the dev-bypass shim session to the MATRON role for ONE script run.
 *
 * `lib/env.ts` parses `process.env` at module load, and ESM evaluates imported modules in source
 * order — so this must be the FIRST import of any script that needs a clinical session, ahead of
 * anything that reaches `@/lib/env`. It only has any effect while `AUTH_DEV_BYPASS` is true, which
 * itself defaults to false and fails closed (`lib/env.ts`).
 */
process.env.AUTH_DEV_ROLES ??= "MATRON";
