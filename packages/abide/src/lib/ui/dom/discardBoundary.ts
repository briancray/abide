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
    /* Nothing to discard (no open marker) — park the cursor and return, as before. */
    if (open === null) {
        hydration.next.set(parent, null)
        return null
    }
    /* Locate the close marker WITHOUT mutating first. Removing as we walk would, on a
       marker/id desync (the await/try block-id counter drifting between server and
       client), delete every remaining sibling before discovering there is no match —
       silently wiping unrelated later content. Throw AT the divergence like `outlet`
       instead, rather than over-clear to end-of-parent. */
    let close: Node | null = open
    while (close !== null && (close as { data?: string }).data !== closeData) {
        close = close.nextSibling
    }
    if (close === null) {
        throw new Error(
            `[abide] hydration desync: boundary open marker has no matching close "${closeData}" — the server DOM is truncated or the block id drifted.`,
        )
    }
    const after = close.nextSibling
    /* Remove open..close inclusive now that the range is known-bounded. */
    let node: Node | null = open
    while (node !== null) {
        const next = node.nextSibling
        parent.removeChild(node)
        if (node === close) {
            break
        }
        node = next
    }
    hydration.next.set(parent, after)
    return after
}
