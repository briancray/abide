import type { RENDER } from './RENDER.ts'

/* Advances the hydration claim cursor past `node`, so the next `claimChild(parent)` returns
   the sibling after it — the write-side counterpart of `claimChild`. A `null` node parks the
   cursor past the end (everything under `parent` is claimed). */
export function advanceClaim(
    hydration: NonNullable<(typeof RENDER)['hydration']>,
    parent: Node,
    node: Node | null,
): void {
    hydration.next.set(parent, node === null ? null : node.nextSibling)
}
