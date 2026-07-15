import { highlight } from 'sugar-high'

/* The snippet languages CodeBlock labels. sugar-high tokenizes JS/TS/JSX, so `ts`
   is highlighted and `sh`/`toml`/`dockerfile`/`text` render as escaped plaintext —
   the shell commands and config snippets this app shows gain little from grammar
   colouring, and TypeScript (the language it shows most) still reads correctly. */
export type Lang = 'ts' | 'sh' | 'toml' | 'dockerfile' | 'text'

/* Escape a raw snippet for the plaintext path — `highlight` already produces safe
   markup, but an unhighlighted lang is interpolated verbatim through `html()`. */
function escapeHtml(code: string): string {
    return code.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/* Highlight a snippet to a full <pre><code> block. Pure, synchronous, isomorphic:
   it runs inline during SSR (the highlighted markup ships in the shell — no RPC, no
   streaming placeholder) and on the client for any dynamically-mounted code, with no
   server round-trip. sugar-high's spans carry `color:var(--sh-*)`; app.css defines
   those variables. ~1 KiB, so unlike shiki it rides into the browser bundle freely. */
export function highlightCode(code: string, lang: Lang = 'ts'): string {
    const inner = lang === 'ts' ? highlight(code) : escapeHtml(code)
    return `<pre class="sh"><code>${inner}</code></pre>`
}
