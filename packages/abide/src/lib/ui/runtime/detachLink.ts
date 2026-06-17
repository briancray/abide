import type { ReactiveLink } from './types/ReactiveLink.ts'

/*
Removes an edge from its source's subscriber list — the `*Sub` splice of an O(1)
unlink. Used when a recompute drops a dependency it no longer reads (`runNode`'s
trim) and when a node tears down entirely (`unlinkDeps`). Leaves the edge's `*Dep`
pointers alone; the caller owns the observer-side list it is walking.
*/
export function detachLink(link: ReactiveLink): void {
    const { dep, prevSub, nextSub } = link
    if (prevSub !== undefined) {
        prevSub.nextSub = nextSub
    } else {
        dep.subsHead = nextSub
    }
    if (nextSub !== undefined) {
        nextSub.prevSub = prevSub
    } else {
        dep.subsTail = prevSub
    }
}
