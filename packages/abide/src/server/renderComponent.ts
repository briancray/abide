import { REGION_CLOSE, REGION_OPEN } from '#ui/REGION.ts'
import type { Component } from './render.ts'

// 32.19 on the server — one invocation, rendered where it stands. The child is a function of its
// props record and hands back its head and its body apart, the same pair a page hands `render`.
//
// THE ANCHORS ARE THE PARENT'S PROBLEM, not the child's: how many top-level nodes the child writes
// is a fact about another file, so the nodes after the invocation cannot be addressed by counting
// and the region is what makes the child's markup one thing to walk to. It is the pair `{#if}`
// already uses, so the client's `regionAt` needs no second case.
//
// 39.1 — the child's head contributions are pushed onto the caller's, so a `<head>` in a component
// reaches the document the way a page's does. The array is the caller's, which is what keeps the
// order the tree order.
export function renderComponent(
    component: Component,
    props: Record<string, () => unknown>,
    heads: string[],
): string {
    const rendered = (
        component as (props: Record<string, () => unknown>) => {
            head: string
            body: string
        }
    )(props)
    if (rendered.head !== '') heads.push(rendered.head)
    return `<!--${REGION_OPEN}-->${rendered.body}<!--${REGION_CLOSE}-->`
}
