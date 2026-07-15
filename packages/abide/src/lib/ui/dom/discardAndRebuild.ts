import type { HydrationCursor } from '../runtime/types/HydrationCursor.ts'
import { withoutHydration } from '../runtime/withoutHydration.ts'
import { discardBoundary } from './discardBoundary.ts'

/*
The shared divergence-recovery mechanics of every named-boundary block: remove the SSR
boundary (open marker through `closeData`, parking the cursor after it) and run a FRESH
build at the freed position with the claim cursor cleared — so the build's helpers create
nodes instead of claiming the discarded ones. `build` receives the node after the removed
boundary (its insertion reference; null = parent's end). Each block keeps its own POLICY —
when to give up on adoption (a resume value that didn't round-trip, a rejected guarded
build, a boundary whose streamed fragment never arrived) — and delegates the dance here.
*/
export function discardAndRebuild<T>(
    hydration: HydrationCursor,
    parent: Node,
    open: Node | null,
    closeData: string,
    build: (after: Node | null) => T,
): T {
    const after = discardBoundary(parent, open, closeData, hydration)
    return withoutHydration(() => build(after))
}
