import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import type { ReactiveLink } from './types/ReactiveLink.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Links a node being read to the observer currently running, in both directions, so
a later write to the node reaches the observer and a recompute can unlink it. A
no-op outside any tracking scope — reads in plain code (and on the server)
register nothing, so the same callable works tracked and untracked.

Edge reuse keeps a settled observer allocation-free across runs. `depsTail` is the
recompute cursor (rewound by `runNode` before compute); the edge just past it is
what last run captured at this position. If that edge already points at `dep`, the
observer is reading the same source in the same order as before — advance the
cursor and reuse the edge, allocating nothing. Otherwise splice a fresh edge in at
the cursor; `runNode` trims whatever stale edges trail the cursor when compute ends.

On re-runs, an edge whose `dep` matches the next slot in the established list is
reused in-place (cursor advances, no allocation). New edges are still appended for
reads that extend the list or find a mismatched slot — including a second consecutive
read of the same source when no matching edge yet follows the cursor.
*/
export function track(dep: ReactiveNode): void {
    const sub = REACTIVE_CONTEXT.observer
    if (sub === undefined) {
        return
    }
    /* The edge to reuse: the one after the cursor, or the head when the cursor sits
       at the start of this run. */
    const reusable = sub.depsTail === undefined ? sub.depsHead : sub.depsTail.nextDep
    if (reusable !== undefined && reusable.dep === dep) {
        sub.depsTail = reusable
        return
    }
    const link: ReactiveLink = {
        dep,
        sub,
        prevDep: sub.depsTail,
        nextDep: reusable,
        prevSub: dep.subsTail,
        nextSub: undefined,
    }
    /* Splice into the observer's dependency list at the cursor. */
    if (sub.depsTail !== undefined) {
        sub.depsTail.nextDep = link
    } else {
        sub.depsHead = link
    }
    if (reusable !== undefined) {
        reusable.prevDep = link
    }
    sub.depsTail = link
    /* Append onto the source's subscriber list (order there is irrelevant). */
    if (dep.subsTail !== undefined) {
        dep.subsTail.nextSub = link
    } else {
        dep.subsHead = link
    }
    dep.subsTail = link
}
