import type { TemplateNode } from './types/TemplateNode.ts'

/*
An element whose children are ONLY text and `<style>` — the common `<h1>{x}</h1>` shape.
The anchor-placement decision for reactive text: `skeletonContext` consults this once and
records the result in `markText`; both back-ends read that map so they agree on where a
text anchor goes. A text-leaf binds its reactive text marker-free on the located element
(`generateBuild`) / emits it without an `<!--a-->` prefix (`generateSSR`); reactive text
interleaved with element children is anchor-positioned instead. Computing it once keeps
the SSR string and the client skeleton from disagreeing about a `<!--a-->` — the first
slice of lifting the positional model out of the two parallel traversals, alongside the
already-shared `isControlFlow` and `skeletonable`.
*/
export function isTextLeaf(node: Extract<TemplateNode, { kind: 'element' }>): boolean {
    return node.children.every((child) => child.kind === 'text' || child.kind === 'style')
}
