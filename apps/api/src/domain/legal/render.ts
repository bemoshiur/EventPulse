/**
 * Trust Center markdown sanitization pipeline — Sprint 2 Day 19 Item 14
 * (Decision J 2026-05-19).
 *
 * Single source of truth for converting authored `body_md` → sanitized
 * `body_html`. Runs server-side AT PUBLISH TIME (not at request time)
 * inside the admin Legal & Trust editor flow. The stored `body_html`
 * column on `legal_document_versions` is the cached, known-safe-at-store
 * output of this pipeline; public pages serve it directly without
 * re-sanitizing.
 *
 * Pipeline (all `unified` ecosystem, MIT-licensed, same upstream author
 * Titus Wormer): markdown → mdast → hast → sanitize → HTML string.
 *
 * Allowlist: `defaultSchema` from `rehype-sanitize` unchanged. Mirrors
 * GitHub-flavored-Markdown safe set — headings, paragraphs, lists,
 * blockquotes, code blocks, inline emphasis, `<a>` with http(s)/mailto
 * hrefs, `<hr>`, `<br>`. Strips `<script>`, `<style>`, `<iframe>`,
 * `<object>`, `<embed>`, `<form>`, `<input>`, all event-handler
 * attributes, all inline `style` attributes, `<img>` with non-https
 * sources, `data:`/`javascript:` URIs.
 *
 * Widening the allowlist requires its own `.claude/memory/decisions.md`
 * entry. The pipeline + allowlist combination is treated as a load-bearing
 * security boundary; ad-hoc tweaks are forbidden.
 *
 * @see .claude/memory/decisions.md "Items 14+15 Trust Center scaffolding +
 *   super admin Legal & Trust editor — pre-code architecture (Decisions J,
 *   K, L, M)" — 2026-05-19, Decision J for the full rationale.
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'

/**
 * Frozen pipeline shared across all calls. unified processors are safe
 * to reuse once `.use()` chains are set up — the documented pattern is
 * to build the pipeline once and call `.process()` per input.
 */
const pipeline = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeSanitize, defaultSchema)
  .use(rehypeStringify)
  .freeze()

/**
 * Sanitize and render markdown to safe HTML for storage in
 * `legal_document_versions.body_html`.
 *
 * @param markdown — Author-supplied markdown source (`body_md` column).
 * @returns Sanitized HTML string. Output is known-safe by construction
 *   (no `<script>`, no event handlers, no inline `style`, no unsafe URI
 *   schemes) so the caller does not need to re-sanitize at render time.
 *   The public-page render path injects this string into the React tree
 *   directly via the React raw-HTML escape hatch; the security boundary
 *   is the pipeline above, not the renderer.
 *
 * @example
 * const html = await renderLegalMarkdown('# Title\n\nBody.')
 * // → '<h1>Title</h1>\n<p>Body.</p>'
 */
export async function renderLegalMarkdown(markdown: string): Promise<string> {
  const file = await pipeline.process(markdown)
  return String(file)
}
