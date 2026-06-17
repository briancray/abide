import type { TemplateNode } from './TemplateNode.ts'

/*
The shared front-end result for a component, consumed by both the client
(`generateBuild`) and server (`generateSSR`) code generators: the lowered script
(signal surface desugared to the doc patch/read API), the signal binding names
(so template expressions rewrite consistently), and the parsed template tree.
*/
export type AnalyzedComponent = {
    script: string
    /* Top-level import statements hoisted out of the script (e.g. child
       components), placed at module scope by the module wrapper. */
    imports: string
    stateNames: Set<string>
    derivedNames: Set<string>
    nodes: TemplateNode[]
    /* One entry per non-empty `<style>` in the template (in source order): the scope
       attribute its covered elements carry (annotated onto `nodes`) and the scoped
       CSS to bundle. A top-level `<style>` covers the whole component; a nested one
       covers only its sibling subtree. Empty for a component with no style. */
    styles: { attribute: string; css: string }[]
    /* False when the template contains an `await` block (not adoptable yet) — the
       router mounts (re-renders) rather than hydrates such a page. */
    hydratable: boolean
}
