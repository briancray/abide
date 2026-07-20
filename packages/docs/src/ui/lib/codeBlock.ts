import { highlight } from './highlight'

// Wraps highlighted source in `<pre class="code"><code>…</code></pre>` for docs pages to render via
// `{html(codeBlock(...))}`. Accepts either a raw `(code, lang)` pair or the `{ code, lang }` result
// of the `snippet` RPC directly, so a page can write `codeBlock(await snippet({…}))` with no
// unpacking. An explicit `lang` argument overrides the one carried on a snippet result.
export function codeBlock(input: string | { code: string; lang: string }, lang?: string): string {
    const code = typeof input === 'string' ? input : input.code
    const language = lang ?? (typeof input === 'string' ? 'text' : input.lang)
    return `<pre class="code" data-lang="${language}"><code>${highlight(code, language)}</code></pre>`
}
