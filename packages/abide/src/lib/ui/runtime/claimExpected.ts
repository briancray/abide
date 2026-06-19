import { claimChild } from './claimChild.ts'
import type { RENDER } from './RENDER.ts'

/*
A hydration claim that MUST succeed. Like `claimChild`, but throws a structural error
when the cursor has no node to claim. A null here means the SSR markup and the client
build disagree about the tree at this position — a hydration desync. Cast away unguarded
(as the claim sites did), that null/undefined derefs several mounts later, far from the
cause; throwing names what was expected AT the divergence, turning the SSR == client DOM
invariant from a compile-time-only parity test into a runtime guard. Use only where the
compiled skeleton GUARANTEES a node — control-flow range markers, keyed-row boundaries —
never where an end-of-list null is legitimate (e.g. a trailing reactive text binding).
*/
export function claimExpected(
    hydration: NonNullable<(typeof RENDER)['hydration']>,
    parent: Node,
    expected: string,
): Node {
    const node = claimChild(hydration, parent)
    if (node === null) {
        throw new Error(
            `[abide] hydration desync: expected ${expected} here, but the server DOM had no matching node — SSR markup and the client build disagree on structure at this position.`,
        )
    }
    return node
}
