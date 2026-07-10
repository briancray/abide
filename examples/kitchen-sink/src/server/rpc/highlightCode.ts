import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import type { HighlighterCore } from 'shiki/core'

export type Lang = 'ts' | 'sh' | 'toml' | 'dockerfile' | 'text'

let cached: Promise<HighlighterCore> | undefined

/*
Shared shiki highlighter. Lazy-loaded once per process — the same instance is
reused across every request. Every shiki import is DYNAMIC and made from inside
this function, so the whole shiki graph is reachable only through the rpc
handler: the client build elides the handler (ADR-0022 D2), which makes these
imports unreachable and drops shiki from the browser bundle entirely (a
top-level `import` would ride along — shiki's entry isn't side-effect-free, so
the bundler can't tree-shake it even once unused).

Fine-grained core, not `shiki/bundle/web`: only the typescript + bash grammars,
the github-light theme, and the wasm-free JavaScript regex engine are packed —
not every bundled language plus the ~600 KiB oniguruma wasm. That is the whole
featureset this app highlights (see resolveLang), at a fraction of the bytes.
*/
function getHighlighter(): Promise<HighlighterCore> {
    if (!cached) {
        cached = (async () => {
            const [
                { createHighlighterCore },
                { createJavaScriptRegexEngine },
                typescript,
                bash,
                githubLight,
            ] = await Promise.all([
                import('shiki/core'),
                import('shiki/engine/javascript'),
                import('@shikijs/langs/typescript'),
                import('@shikijs/langs/bash'),
                import('@shikijs/themes/github-light'),
            ])
            return createHighlighterCore({
                themes: [githubLight.default],
                langs: [typescript.default, bash.default],
                engine: createJavaScriptRegexEngine(),
            })
        })()
    }
    return cached
}

/* Maps a CodeBlock lang to a shiki grammar. Only typescript / bash are packed;
   langs without a grammar (toml, dockerfile) render as shiki's built-in
   plaintext — clean, monochrome, never a missing-grammar throw. */
function resolveLang(lang: Lang): string {
    if (lang === 'ts') {
        return 'typescript'
    }
    if (lang === 'sh') {
        return 'bash'
    }
    return 'text'
}

/*
Highlights a source snippet via shiki and returns the rendered HTML.
Server-only — the bundler swaps the import on the client to a remote
proxy, so the shiki runtime never ships to the browser. CodeBlock calls
it as a bare smart read, so the SSR pass writes the highlighted HTML into
the cache snapshot and the client hydrates without a second fetch. Same
code+lang across pages share one cache entry.

GET, not POST: highlighting is a pure read (no side effects), so its cache
entry is REPLAYABLE — only GET entries ride the SSR warm snapshot
(REPLAYABLE_METHODS), so the client's cold re-run reads the highlighted HTML
warm instead of refetching every code block. `code`/`lang` ride the query
string.
*/
export const highlightCode = GET(async ({ code, lang }: { code: string; lang: Lang }) => {
    const highlighter = await getHighlighter()
    const html = highlighter.codeToHtml(code, {
        lang: resolveLang(lang),
        theme: 'github-light',
    })
    return json({ html })
})
