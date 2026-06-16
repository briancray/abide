import type { RENDER } from './RENDER.ts'

/* The next server-rendered node to claim under `parent` during hydration,
   defaulting to its first child when the pointer hasn't been set yet. */
export function claimChild(
    hydration: NonNullable<(typeof RENDER)['hydration']>,
    parent: Node,
): Node | null {
    return hydration.next.has(parent) ? (hydration.next.get(parent) ?? null) : parent.firstChild
}
