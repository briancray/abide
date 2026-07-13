import type { TemplateNode } from './TemplateNode.ts'

/*
The shared front-end result for a component, consumed by both the client
(`generateBuild`) and server (`generateSSR`) code generators: the lowered script
(signal surface desugared to the doc patch/read API), the signal binding names
(so template expressions rewrite consistently), and the parsed template tree.
*/
export type AnalyzedComponent = {
    /* The lowered client script — keeps `effect(...)` calls (client lifecycle). */
    script: string
    /* The same lowered script with `effect(...)` calls stripped, for the SSR render
       (effects emit no HTML and must not run on the server). Produced from the one
       parse `script` came from, not a downstream re-parse. */
    ssrScript: string
    /* Top-level import statements hoisted out of the script (e.g. child
       components), placed at module scope by the module wrapper. */
    imports: string
    /* The local binding names of reactive-surface imports (`state`/`effect`) the dead-import
       filter dropped as unused. The module wrapper's backstop asserts none of them still
       appears in the generated output — an independent check that the drop didn't strand a
       live reference (e.g. one a nested branch script keeps literal). */
    droppedReactiveImports: Set<string>
    stateNames: Set<string>
    derivedNames: Set<string>
    computedNames: Set<string>
    /* Component signals read through `$$readCell(name)`: every `linked` and every async
       `computed`. Threaded to both back-ends so a template reference (`{draft}`) lowers to
       the unified cell read consistently on client and server. */
    cellReadNames: Set<string>
    /* The subset of `cellReadNames` that are BLOCKING `await` cells (ADR-0042): a template-injected
       `{await X}` cell or a script `computed(await …)`. The CLIENT back-end reads these via
       `$$readCellBlocking` (suspend-on-pending) rather than `$$readCell`. */
    blockingCellNames: Set<string>
    nodes: TemplateNode[]
    /* One entry per non-empty `<style>` in the template (in source order): the scope
       attribute its covered elements carry (annotated onto `nodes`) and the scoped
       CSS to bundle. A top-level `<style>` covers the whole component; a nested one
       covers only its sibling subtree. Empty for a component with no style. */
    styles: { attribute: string; css: string }[]
    /* Always `true` — hydration adopts every block in place, including `await`
       (streamed value seeded through the resume manifest). */
    hydratable: boolean
}
