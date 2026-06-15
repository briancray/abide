import type { TemplateNode } from './TemplateNode.ts'

/*
The shared front-end result for a component, consumed by both the client
(`generateBuild`) and server (`generateSSR`) code generators: the lowered script
(signal surface desugared to the doc patch/read API), the signal binding names
(so template expressions rewrite consistently), and the parsed template tree.
*/
export type AnalyzedComponent = {
    script: string
    stateNames: Set<string>
    derivedNames: Set<string>
    nodes: TemplateNode[]
    /* Present when the component has a `<style>`: the scope attribute every
       element carries and the scoped CSS to inject. */
    style: { attribute: string; css: string } | undefined
}
