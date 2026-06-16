import { analyzeComponent } from './analyzeComponent.ts'
import { generateSSR } from './generateSSR.ts'
import { SSR_ESCAPE } from './SSR_ESCAPE.ts'
import { stripEffects } from './stripEffects.ts'

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
*/
export function compileSSR(source: string, isLayout = false): string {
    const { script, stateNames, derivedNames, nodes, style } = analyzeComponent(source)
    const ssr = generateSSR(nodes, stateNames, derivedNames, style?.attribute, isLayout)
    /* A `<style>` block's scoped CSS is emitted into the markup. */
    const stylePush =
        style === undefined ? '' : `$out.push(${JSON.stringify(`<style>${style.css}</style>`)});\n`
    /* `typeof model` guards a component with no reactive state (a pure-async or
       static component declares no `model`); its snapshot is then empty. */
    return (
        `enterRenderPass();\ntry {\n${stripEffects(script)}\n${SSR_ESCAPE}\nconst $out = [];\nconst $awaits = [];\n${stylePush}${ssr}` +
        `return { html: $out.join(''), state: (typeof model !== 'undefined' ? model.snapshot() : {}), awaits: $awaits };\n` +
        `} finally { exitRenderPass(); }`
    )
}
