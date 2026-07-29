// WHICH ITEMS A KEYED `{#for}` RECONCILE MOVES — the decision, separated from the DOM writes it drives.
//
// The contract here is WORK, not output: a rebuild and a minimal reconcile produce byte-identical DOM
// and differ only in how many ranges moved. `forReconcile.test.ts` already guards that end-to-end —
// it mounts a list, counts re-added `<li>` nodes through a `MutationObserver`, and asserts a two-row
// swap of 200 costs at most 4. That test stays; it is the integration proof, and it is what catches a
// regression in the DOM writes this module does not own.
//
// What it cannot do is reach the ALGORITHM's edges. It is a fuzz over plausible list mutations, so it
// hits the empty subsequence, a single surviving row, an all-fresh list and duplicate positions only
// by luck — and `increasingSubsequence` is, in that file's own words, "a real algorithm with real
// off-by-one surface". Its empty-tails branch exists because folding it into the binary search
// compared against `undefined` and silently refused to seed, which moved the whole list while
// rendering it correctly. That is a bug reachable by construction and not by fuzzing.
//
// So: the decision is a pure function over `number[]`, its edges are asserted directly, and the cases
// that DISTINGUISH implementations (a two-row swap, where a minimal plan names 2 indices and a
// cascading one names ~996 of a thousand) are stated as arithmetic instead of as mounted DOM. A full
// reverse is included as the contrast — it moves nearly everything under any correct plan, which is
// exactly why it cannot carry the contract.

// `oldPositions` entry for an item built during this reconcile — it has no previous position, and is
// never a candidate to be left in place.
export const NEW_ITEM = -1

// Indices of a longest increasing subsequence of `positions`, ignoring `NEW_ITEM` entries.
//
// These are the items whose relative DOM order is ALREADY correct, so leaving them alone and moving
// everything else is the minimum number of moves that reaches the target order. Patience-sorting shape:
// `tails[length - 1]` is the index ending the best subsequence of that length, binary-searched;
// `previous` records each index's predecessor so the answer can be walked back out at the end.
export function increasingSubsequence(positions: readonly number[]): number[] {
    const previous: number[] = new Array(positions.length)
    const tails: number[] = []
    for (let index = 0; index < positions.length; index++) {
        const position = positions[index] as number
        if (position === NEW_ITEM) continue
        // The empty case is called out rather than folded into the search below: with no tails yet
        // there is nothing to compare against, and reading `tails[0]` would compare against undefined
        // and silently refuse to seed — leaving the subsequence permanently empty (every item then
        // looks out of place, which is CORRECT but moves the whole list, the exact bug this fixes).
        if (tails.length === 0) {
            previous[index] = -1
            tails.push(index)
            continue
        }
        const last = tails[tails.length - 1] as number
        if ((positions[last] as number) < position) {
            previous[index] = last
            tails.push(index)
            continue
        }
        // First tail whose position is >= this one; that is the length this index improves on.
        let low = 0
        let high = tails.length - 1
        while (low < high) {
            const mid = (low + high) >> 1
            if ((positions[tails[mid] as number] as number) < position) low = mid + 1
            else high = mid
        }
        if (position < (positions[tails[low] as number] as number)) {
            previous[index] = low > 0 ? (tails[low - 1] as number) : -1
            tails[low] = index
        }
    }
    let cursor = tails.length
    if (cursor === 0) return tails
    let walk = tails[cursor - 1] as number
    while (cursor-- > 0) {
        tails[cursor] = walk
        walk = previous[walk] as number
    }
    return tails
}

// The survivors the reorder may leave exactly where they are, or `null` when EVERY survivor is already
// in ascending old order and so only freshly built items need positioning.
//
// The `null` is not a micro-optimisation dressed as a case: the overwhelmingly common shapes — append,
// prepend-free create, a value-only update, a pure removal — all land there, and it skips the sequence
// solve and its two arrays entirely. `ascending` is threaded in rather than re-derived because the
// caller already establishes it in the pass that builds `oldPositions`, one comparison per item.
export function keptInPlace(oldPositions: readonly number[], ascending: boolean): number[] | null {
    return ascending ? null : increasingSubsequence(oldPositions)
}

// The indices the reorder will REPOSITION, ascending.
//
// Derived from `keptInPlace`, so it cannot describe a different algorithm than the one that runs. It
// is a separate function only because the reconcile interleaves this decision with the DOM writes it
// drives — and because the live loop additionally SKIPS a planned move whose node already happens to
// sit at the reference, which makes this an upper bound on real `moveRange` calls, never a lower one.
// That is the right bound for the contract: what must not happen is the PLAN naming the whole list.
export function plannedMoves(oldPositions: readonly number[]): number[] {
    const kept = keptInPlace(oldPositions, isAscending(oldPositions))
    const moves: number[] = []
    if (kept === null) {
        // Survivors are already correct relative to one another; only a freshly built item, appended at
        // the block end, needs placing.
        for (let index = 0; index < oldPositions.length; index++) {
            if (oldPositions[index] === NEW_ITEM) moves.push(index)
        }
        return moves
    }
    const keptSet = new Set(kept)
    for (let index = 0; index < oldPositions.length; index++) {
        if (!keptSet.has(index)) moves.push(index)
    }
    return moves
}

// Are the surviving items' old positions non-decreasing? `NEW_ITEM` entries do not participate — they
// have no old position to be out of order with.
export function isAscending(oldPositions: readonly number[]): boolean {
    let highestSoFar = -1
    for (let index = 0; index < oldPositions.length; index++) {
        const position = oldPositions[index] as number
        if (position === NEW_ITEM) continue
        if (position < highestSoFar) return false
        highestSoFar = position
    }
    return true
}
