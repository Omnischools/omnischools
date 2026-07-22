/**
 * Markup stripping for TEST AND HARNESS use only — never shipped, never given untrusted input.
 *
 * WHY THIS FILE EXISTS. Three copies of this logic had drifted apart across the sickbay work
 * (`lib/sickbay/visit-copy.test.ts`, `lib/sickbay/board-copy.test.ts`, `scripts/verify-sickbay-board.ts`),
 * and the third was materially weaker than the other two — `/<script[\s\S]*?<\/script>/g`, with no `i`
 * flag, no `<style>`, and a single pass. CodeQL was right about it (`js/bad-tag-filter`, alert #11 on
 * PR #175): an upper-case `<SCRIPT>` walked straight through. Copy-paste was the root cause, so the
 * fix is one implementation, not three patches.
 *
 * WHAT THE CALLERS NEED, and why there are two exports rather than one:
 *   • the harness separates rendered MARKUP from the RSC flight payload (which lives inside
 *     `<script>` tags) — it wants the blocks gone and every other tag KEPT;
 *   • the copy tests compare visible text character-for-character against a surface mockup — they
 *     want everything gone.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * CodeQL `js/incomplete-multi-character-sanitization` fires on the block strip below and is
 * DISMISSED as a false positive (the same adjudication as alert #8, PR #174 — see the note in
 * `lib/sickbay/visit-copy.test.ts`). Do not "fix" it again and do not reopen the chase: three
 * sibling alerts were already closed ON MERIT, and those fixes are what you see here —
 *   • `js/double-escaping` was a REAL bug (`&amp;` decoded before `&lt;`/`&gt;`) → `&amp;` decodes LAST;
 *   • single-pass stripping was genuinely incomplete → the fixpoint loop;
 *   • a dangling `<script` with no closing `>` was a fixpoint of both regexes → the stray `<` is dropped;
 *   • `js/bad-tag-filter` was a REAL bug (no `i` flag) → the pattern is case-insensitive.
 * It still fires because the query reasons LOCALLY about one `.replace` and cannot observe the
 * enclosing loop. Satisfying it needs an HTML-parser dependency to serve a test helper — declined.
 * The rule's premise does not hold here regardless: nothing in this file is shipped, its input is a
 * repo-authored mockup or our own dev server's response, and its output is compared with `===`
 * and never rendered. There is no sink.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

/**
 * Remove `<script>` and `<style>` ELEMENTS WITH THEIR CONTENT — case-insensitively, to a fixpoint.
 * Every other tag is left intact.
 *
 * Case-insensitivity is load-bearing, not defensive: `<SCRIPT>` surviving would leave the RSC flight
 * payload inside what the harness then counts as rendered markup.
 */
export function stripScriptStyleBlocks(input: string): string {
  let s = input;
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "");
  }
  return s;
}

/**
 * Strip markup to visible text: script/style blocks wholesale, then every remaining tag, to a
 * fixpoint — removing a tag can splice a new one together out of its neighbours
 * (`<scr<b></b>ipt>` → `<script>`), so a single `.replace` is not idempotent.
 *
 * The trailing `<` removal handles a dangling `<script` with no closing `>`, which is a fixpoint of
 * both patterns above and would otherwise survive. Safe by ordering: callers decode entities AFTER
 * this runs, so a legitimate `&lt;` still becomes `<` and is untouched.
 */
export function stripMarkup(input: string): string {
  let s = stripScriptStyleBlocks(input);
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = stripScriptStyleBlocks(s).replace(/<[^>]*>/g, "");
  }
  return s.replace(/</g, "");
}
