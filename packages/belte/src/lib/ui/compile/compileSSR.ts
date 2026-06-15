import { analyzeComponent } from './analyzeComponent.ts'
import { generateSSR } from './generateSSR.ts'
import { SSR_ESCAPE } from './SSR_ESCAPE.ts'

/*
Compiles a component into the body of a server render function. Runs the shared
front-end, then the SSR back-end, and returns `{ html, state, awaits }`:

  - `html`  — server-rendered markup (await blocks render their pending shell);
  - `state` — the document snapshot the client adopts on resume;
  - `awaits` — pending await blocks (id + promise + resolved/error renderers) that
    `renderToStream` flushes out of order; empty for a fully synchronous component.

Runs with `doc`/`state`/`derived`/`effect` in scope and defines `model`.
*/
export function compileSSR(source: string): string {
    const { script, stateNames, derivedNames, nodes } = analyzeComponent(source)
    const ssr = generateSSR(nodes, stateNames, derivedNames)
    /* `typeof model` guards a component with no reactive state (a pure-async or
       static component declares no `model`); its snapshot is then empty. */
    return `${script}\n${SSR_ESCAPE}\nconst $out = [];\nconst $awaits = [];\n${ssr}return { html: $out.join(''), state: (typeof model !== 'undefined' ? model.snapshot() : {}), awaits: $awaits };`
}
