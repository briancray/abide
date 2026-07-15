import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'
import { getHighlighter } from '../getHighlighter.ts'

export type Lang = 'ts' | 'sh' | 'toml' | 'dockerfile' | 'text'

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
the cache snapshot and the client hydrates without a second fetch.

POST so the `code` payload rides the request body, not a long query string —
the method is a transport choice, not a mutation: highlighting is a pure
function of (code, lang). A mutating rpc still accepts a `cache` policy, so
`shared` memoises the rendered HTML in the process store — same code+lang
across every page share one entry, and shiki runs once per snippet rather than
once per request. Any inline (bare smart read) call also seeds the SSR warm
snapshot regardless of method, so the client hydrates the highlighted HTML warm
instead of refetching every code block — seeding, unlike unprompted replay
(invalidate/refresh, still GET-only), doesn't need an idempotent verb.
*/
export const highlightCode = POST(
    async ({ code, lang }: { code: string; lang: Lang }) => {
        const highlighter = await getHighlighter()
        const html = highlighter.codeToHtml(code, {
            lang: resolveLang(lang),
            theme: 'github-light',
        })
        return json({ html })
    },
    { cache: { shared: true } },
)
