// vitest stub for Next's `server-only` marker (aliased in vitest.config.ts). Next resolves this
// specifier at build time; in the node test env it is unresolvable, so we point it at this no-op so
// server components (e.g. the audit activity feed) can be rendered with renderToStaticMarkup.
export {};
