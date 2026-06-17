import type { RENDER } from '../runtime/RENDER.ts'

/* Remove an SSR boundary — open marker through close marker (inclusive) — and park
   the hydration cursor on the node after it, returning that node. A fresh run then
   replaces the boundary in place without duplicating the server's pending shell.
   Shared by the await and try blocks (await ignores the return). */
export function discardBoundary(
    parent: Node,
    open: Node | null,
    closeData: string,
    hydration: NonNullable<(typeof RENDER)['hydration']>,
): Node | null {
    let node = open
    let after: Node | null = null
    while (node !== null) {
        const next = node.nextSibling
        const isClose = (node as { data?: string }).data === closeData
        parent.removeChild(node)
        if (isClose) {
            after = next
            break
        }
        node = next
    }
    hydration.next.set(parent, after)
    return after
}
