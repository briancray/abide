import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'
import { createHighlighter, type HighlighterGeneric } from 'shiki/bundle/web'

type Lang = 'ts' | 'svelte' | 'sh' | 'toml' | 'dockerfile' | 'text'
type Theme = 'github-dark'

let cached: Promise<HighlighterGeneric<Lang, Theme>> | undefined

/*
Shared shiki highlighter. Lazy-loaded once per process — the same
instance is reused across every request. `shiki/bundle/web` ships
typescript, svelte, and bash (among others) pre-packed so the
highlighter resolves synchronously after the first await.
*/
function getHighlighter(): Promise<HighlighterGeneric<Lang, Theme>> {
    if (!cached) {
        cached = createHighlighter({
            themes: ['github-dark'],
            langs: ['typescript', 'svelte', 'bash'],
        }) as Promise<HighlighterGeneric<Lang, Theme>>
    }
    return cached
}

/* Maps a CodeBlock lang to a shiki grammar. The web bundle ships typescript /
   svelte / bash; langs without a packed grammar (toml, dockerfile) render as
   shiki's built-in plaintext — clean, monochrome, never a missing-grammar throw. */
function resolveLang(lang: Lang): string {
    if (lang === 'ts') return 'typescript'
    if (lang === 'sh') return 'bash'
    if (lang === 'toml' || lang === 'dockerfile' || lang === 'text') return 'text'
    return lang
}

/*
Highlights a source snippet via shiki and returns the rendered HTML.
Server-only — the bundler swaps the import on the client to a remote
proxy, so the shiki runtime never ships to the browser. CodeBlock
wraps every call in `cache()`, so the SSR pass writes the highlighted
HTML into the cache snapshot and the client hydrates without a second
fetch. Same code+lang across pages share one cache entry.
*/
export const highlightCode = POST<{ code: string; lang: Lang }, { html: string }>(
    async ({ code, lang }) => {
        const highlighter = await getHighlighter()
        const html = highlighter.codeToHtml(code, {
            lang: resolveLang(lang),
            theme: 'github-dark',
        })
        return json({ html })
    },
)
