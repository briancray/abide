// D69'S DERIVED PROBES. 11.20 has `s.pending`, `s.refreshing` and `s.done` propagate,
// and 11.22 has the propagated probe DERIVED ON THE READ THAT ASKS rather than held
// as a subscription per source. So the memo holds nothing: the walk calls `subscribe`
// while the ASKING reader is active, and the edge lands on that reader by ordinary
// tracking.
//
// ITERATIVE. The recursive form had unbounded depth on a memo chain, on a path walked
// per probe read per row per frame, and 3.1 says a probe MUST NOT throw — a stack
// overflow inside `s.pending()` is that throw.

import { WORK } from './counters.ts'
import { subscribe } from './graph.ts'
import type { ReactiveNode } from './ReactiveNode.ts'

let walkCounter = 0

export function nextWalk(): number {
    walkCounter += 1
    return walkCounter
}

export function propagated(
    node: ReactiveNode,
    mask: number,
    walk: number,
): boolean {
    const stack: ReactiveNode[] = [node]
    while (stack.length > 0) {
        // `undefined` on a state, on a room, and on a keyed memo — 11.25.
        const reader = (stack.pop() as ReactiveNode).reader
        if (reader === undefined) continue
        for (let link = reader.sources; link !== undefined; ) {
            // The successor is read BEFORE subscribing. `subscribe` writes to the
            // asking reader, which is a different reader UNLESS the probed graph
            // reaches back to it — and a cycle would then splice the list this loop
            // is standing in.
            const next = link.nextSource
            const source = link.node
            // A diamond is one node reached twice, not two. Without the mark the walk
            // is 2^(k+1)−2 visits over a k-deep 2-wide layer chain rather than 2k,
            // and the short-circuit hides it exactly when the answer is `true` — so
            // the cost only shows on the `false` reads, which are the common ones.
            if (source.walk !== walk) {
                source.walk = walk
                WORK.descents += 1
                // 3.3 — the asker joins that probe alone.
                subscribe(source, mask)
                if ((source.status & mask) !== 0) return true
                stack.push(source)
            }
            link = next
        }
    }
    return false
}
