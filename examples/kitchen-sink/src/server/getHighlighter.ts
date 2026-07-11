import type { HighlighterCore } from 'shiki/core'

let cached: Promise<HighlighterCore> | undefined

/*
Shared shiki highlighter. Lazy-loaded once per process — the same instance is
reused across every request (highlightCode and typeSource both draw on it).
Every shiki import is DYNAMIC and made from inside this function, so the whole
shiki graph is reachable only through the server: the client build elides the
handlers that call it (ADR-0022 D2), which makes these imports unreachable and
drops shiki from the browser bundle entirely (a top-level `import` would ride
along — shiki's entry isn't side-effect-free, so the bundler can't tree-shake it
even once unused).

Fine-grained core, not `shiki/bundle/web`: only the typescript + bash grammars,
the github-light theme, and the wasm-free JavaScript regex engine are packed —
not every bundled language plus the ~600 KiB oniguruma wasm. That is the whole
featureset this app highlights, at a fraction of the bytes.
*/
export function getHighlighter(): Promise<HighlighterCore> {
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
