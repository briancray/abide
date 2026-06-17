import type { ReactiveNode } from './ReactiveNode.ts'

/*
One dependency edge in the reactive graph: `sub` (the observer) reads `dep` (the
source). The edge is threaded into two intrusive doubly-linked lists at once — the
source's list of subscribers (the `*Sub` pointers, walked forward on a write) and
the observer's list of dependencies (the `*Dep` pointers, walked on recompute to
reuse or drop edges). Replacing the former `Set` on each side makes link/unlink
O(1) with no per-edge allocation once a node settles, and propagation a sequential
pointer walk instead of a hashed-set iteration.
*/
export type ReactiveLink = {
    dep: ReactiveNode
    sub: ReactiveNode
    /* Siblings in `sub`'s dependency list (the edges `sub` captured, in read order). */
    prevDep: ReactiveLink | undefined
    nextDep: ReactiveLink | undefined
    /* Siblings in `dep`'s subscriber list (every observer reading `dep`). */
    prevSub: ReactiveLink | undefined
    nextSub: ReactiveLink | undefined
}
