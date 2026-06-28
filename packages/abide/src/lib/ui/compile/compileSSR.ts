import { analyzeComponent } from './analyzeComponent.ts'
import { generateSSR } from './generateSSR.ts'
import { SSR_ESCAPE } from './SSR_ESCAPE.ts'
import type { AnalyzedComponent } from './types/AnalyzedComponent.ts'

/*
Compiles a component into the body of a server render function. Runs the shared
front-end, then the SSR back-end, and returns `{ html, state, awaits }`:

  - `html`  — server-rendered markup (await blocks render their pending shell);
  - `state` — the document snapshot the client adopts on resume;
  - `awaits` — pending await blocks (id + promise + resolved/error renderers) that
    `renderToStream` flushes out of order; empty for a fully synchronous component.

Effects are stripped — they are client lifecycle and emit no HTML, so the server
render is a snapshot of the markup before any effect runs.

Defines `model` with `doc`/`state`/`computed`/`effect` in scope. The block-id counter is
the request-local `$ctx` (threaded into child renders), not a module global — a blocking
`await` block awaits its promise at its structural position and renders inline, so ids
allocate depth-first like the client; render yields at that `await`, and a shared global
counter would interleave across concurrent requests. `$ctx` defaults to a fresh counter
when a caller (a test, a top-level render) omits it.

The body is wrapped in an ASYNC IIFE (returns `Promise<SsrRender>`) ONLY when it contains
an inline `await` — a blocking `{#await … then}` block, a child-component render, a `<slot>`
read (its `$children` builder is async), or a top-level `await` in the author script. A
purely synchronous / streaming-await / try-only component returns `SsrRender` directly. The
framework always `await`s `render()`, so production is uniform either way; the sync return
keeps static pages off the microtask queue and leaves the bulk of the SSR tests synchronous.

The reactive scope brackets the body; it is entered synchronously before any inline `await`,
so `const model = scope()` resolves correctly, and `model` is captured for the rest of the
render (its reads are object-method calls, not scope lookups, so they stay correct across
the awaits).

`analyzed` is a lazy default: a direct caller (tests) omits it and the front-end
runs here, but `compileModule` shares one analysis across both back-ends.
*/
export function compileSSR(
    source: string,
    isLayout = false,
    scopeSeed?: string,
    analyzed: AnalyzedComponent = analyzeComponent(source, scopeSeed),
): string {
    const { ssrScript: lowered, stateNames, derivedNames, computedNames, nodes } = analyzed
    const ssr = generateSSR(nodes, stateNames, derivedNames, computedNames, isLayout)
    /* No `<style>` in the markup — the scoped CSS is bundled into the entry stylesheet
       the shell links (see `abideUiPlugin`), so SSR output is styled by that sheet. The
       elements still carry their `data-a-…` scopes via `generateSSR`. */
    /* `typeof model` guards a component with no reactive state (a pure-async or
       static component declares no `model`); its snapshot is then empty. */
    const body =
        `const $scope = $$enterScope();\ntry {\n${lowered}\n${SSR_ESCAPE}\nconst $out = [];\nconst $awaits = [];\nconst $resume = {};\n${ssr}` +
        `return { html: $out.join(''), state: (typeof $$model !== 'undefined' ? $$model.snapshot() : {}), awaits: $awaits, resume: $resume };\n` +
        `} finally { $$exitScope($scope); }`
    /* An inline `await` — a blocking await block, a child render, a slot read, or a
       top-level `await` in the author script — forces an async wrapper. Match `await` as a
       standalone token (operator), so a no-space form (`await(x)`, `await[i]`, `` await`t` ``)
       is caught where a `.includes('await ')` substring scan would miss it and emit a bare
       top-level `await` in a non-async function (a SyntaxError). `(?!:)` excludes the
       `<!--abide:await:N-->` boundary-marker strings; `\b` excludes `$awaits`. A false
       positive (the token in author text) only costs a needless async wrapper, never a crash. */
    const needsAsync = /\bawait\b(?!:)/.test(`${lowered}${ssr}`)
    return `var $ctx = $ctx || { next: 0 };\n${needsAsync ? `return (async () => {\n${body}\n})();` : body}`
}
