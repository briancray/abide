import { analyzeComponent } from './analyzeComponent.ts'
import { generateSSR } from './generateSSR.ts'
import { SSR_ESCAPE } from './SSR_ESCAPE.ts'
import { stripEffects } from './stripEffects.ts'
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

Runs with `doc`/`state`/`derived`/`effect`/`nextBlockId`/`enterRenderPass`/
`exitRenderPass` in scope and defines `model`. The body is bracketed by a render
pass so the outermost render resets the block-id counter and an inlined child
render continues it — keeping await/try ids unique and aligned with the client.

`analyzed` is a lazy default: a direct caller (tests) omits it and the front-end
runs here, but `compileModule` shares one analysis across both back-ends.
*/
export function compileSSR(
    source: string,
    isLayout = false,
    scopeSeed?: string,
    analyzed: AnalyzedComponent = analyzeComponent(source, scopeSeed),
): string {
    const { script, stateNames, derivedNames, nodes } = analyzed
    const ssr = generateSSR(nodes, stateNames, derivedNames, isLayout)
    /* No `<style>` in the markup — the scoped CSS is bundled into the entry stylesheet
       the shell links (see `abideUiPlugin`), so SSR output is styled by that sheet. The
       elements still carry their `data-a-…` scopes via `generateSSR`. */
    /* `typeof model` guards a component with no reactive state (a pure-async or
       static component declares no `model`); its snapshot is then empty. */
    return (
        `enterRenderPass();\ntry {\n${stripEffects(script)}\n${SSR_ESCAPE}\nconst $out = [];\nconst $awaits = [];\n${ssr}` +
        `return { html: $out.join(''), state: (typeof model !== 'undefined' ? model.snapshot() : {}), awaits: $awaits };\n` +
        `} finally { exitRenderPass(); }`
    )
}
