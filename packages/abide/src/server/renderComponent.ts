import { REGION_CLOSE, REGION_OPEN } from '#ui/REGION.ts'
import type { Component, Rendered } from './render.ts'

// 32.18 on the server — one invocation, rendered where it stands. The child is a function of its
// props record and hands back its head and its body apart, the same pair a page hands `render`.
//
// THE ANCHORS ARE THE PARENT'S PROBLEM, not the child's: how many top-level nodes the child writes
// is a fact about another file, so the nodes after the invocation cannot be addressed by counting
// and the region is what makes the child's markup one thing to walk to. It is the pair `{#if}`
// already uses, so the client's walk (`regionHere`) needs no second case.
//
// 39.1 — the child's head contributions are pushed onto the caller's, so a `<head>` in a component
// reaches the document the way a page's does. The array is the caller's, which is what keeps the
// order the tree order.
//
// 32.37 — A TAG CHOOSING BY A VALUE (32.35) MAY CHOOSE NOTHING, and writes the pair alone: the
// region is still there for the browser to fill when the value arrives.
export function renderComponent(
    component: Component | undefined | null,
    props: Record<string, () => unknown>,
    heads: string[],
): string {
    if (component == null) return `<!--${REGION_OPEN}--><!--${REGION_CLOSE}-->`
    const rendered = (
        component as (props: Record<string, () => unknown>) => Rendered
    )(props)
    if (rendered.head !== '') heads.push(rendered.head)
    return `<!--${REGION_OPEN}-->${rendered.body}<!--${REGION_CLOSE}-->`
}
