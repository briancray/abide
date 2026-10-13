import { regionMarkup } from '#shared/anchorMarkup.ts'
import type { Component, Rendered } from './render.ts'

/**
 * One component invocation's body markup, wrapped in region anchors; its head goes onto `heads`.
 *
 * 32.17 on the server — one invocation, rendered where it stands. The child is a function of its
 * props record and hands back its head and its body apart, the same pair a page hands `render`.
 *
 * THE ANCHORS ARE THE PARENT'S PROBLEM, not the child's: how many top-level nodes the child writes
 * is a fact about another file, so the nodes after the invocation cannot be addressed by counting
 * and the region is what makes the child's markup one thing to walk to. It is the pair `{#if}`
 * already uses, so the client's walk (`regionHere`) needs no second case.
 *
 * 39.1 — the child's head contributions are pushed onto the caller's, so a `<head>` in a component
 * reaches the document the way a page's does. The array is the caller's, which is what keeps the
 * order the tree order.
 *
 * 32.36 — A TAG CHOOSING BY A VALUE (32.34) MAY CHOOSE NOTHING, and writes the pair alone: the
 * region is still there for the browser to fill when the value arrives.
 */
export function renderComponent(
    component: Component | undefined | null,
    props: Record<string, () => unknown>,
    heads: string[],
): string {
    if (component == null) return regionMarkup('')
    const rendered = (
        component as (props: Record<string, () => unknown>) => Rendered
    )(props)
    // 35.16 — a document is written by the outermost component alone, and this one is placed.
    if (rendered.document !== undefined)
        throw new Error(
            'abide: a component that writes <html> is placed inside another, and only the outermost component writes the document. RULEBOOK 35.16.',
        )
    if (rendered.head !== '') heads.push(rendered.head)
    return regionMarkup(rendered.body)
}
