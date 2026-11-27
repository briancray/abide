// 18.41 — A REPLACED VALUE'S CHANGE AS JSON PATCH: applied to the value before, the ops build the value
// after, whatever moved, and a list a `key` tells apart is changed row by row rather than rewritten.

import { expect, test } from 'bun:test'

import { applyPatch } from '#shared/applyPatch.ts'
import { diffOps } from '#shared/reactive/diffOps.ts'

const rebuilt = (before: unknown, after: unknown, key: string | null) => {
    const copy = structuredClone(before)
    const root = { value: copy }
    applyPatch(
        root,
        diffOps(before, after, key).map((op) => ({
            ...op,
            path: `/value${op.path}`,
            ...('from' in op ? { from: `/value${op.from}` } : {}),
        })) as never,
    )
    return root.value
}

// THE REVERT: diff arrays by position whatever `key` says; the row taken from the front replaces
// every row after it, and `ops: 1` is `ops: 7`.
test('a keyed list is changed row by row, and the ops rebuild it — 18.41', () => {
    const before = [
        { id: 'a', n: 1 },
        { id: 'b', n: 2 },
        { id: 'c', n: 3 },
        { id: 'd', n: 4 },
    ]
    const after = [
        { id: 'b', n: 2 },
        { id: 'c', n: 3 },
        { id: 'd', n: 4 },
    ]
    expect(`ops: ${diffOps(before, after, 'id').length}`).toBe('ops: 1')
    const shuffled = [
        { id: 'd', n: 40 },
        { id: 'a', n: 1 },
        { id: 'e', n: 5 },
        { id: 'c', n: 3 },
    ]
    expect(rebuilt(before, shuffled, 'id')).toEqual(shuffled)
})

test('records and lists by position are rebuilt by their ops — 18.41', () => {
    const before = {
        name: 'Acme',
        tags: ['a', 'b', 'c'],
        owner: { id: 1, nick: 'x' },
    }
    const after = {
        name: 'Acme Co',
        tags: ['a', 'z'],
        owner: { id: 1 },
        stage: 'won',
    }
    expect(rebuilt(before, after, null)).toEqual(after)
    expect(diffOps(before, before, null)).toEqual([])
    expect(diffOps(1, 2, null)).toEqual([{ op: 'replace', path: '', value: 2 }])
})

// The keyed diff as it was first written: the array the ops build simulated alongside, a look-ahead
// scan per position. Kept as the reference the faster one is held to, op for op.
function simulatedOps(
    before: unknown[],
    after: unknown[],
    keyOf: (element: unknown) => unknown,
): unknown[] {
    const ops: unknown[] = []
    const wanted = new Set<unknown>()
    for (const element of after) wanted.add(keyOf(element))
    const current = before.slice()
    for (let at = current.length - 1; at >= 0; at -= 1)
        if (!wanted.has(keyOf(current[at]))) {
            ops.push({ op: 'remove', path: `/${at}` })
            current.splice(at, 1)
        }
    for (let at = 0; at < after.length; at += 1) {
        const target = after[at]
        const id = keyOf(target)
        let from = -1
        for (let look = at; look < current.length; look += 1)
            if (keyOf(current[look]) === id) {
                from = look
                break
            }
        if (from === -1) {
            ops.push({ op: 'add', path: `/${at}`, value: target })
            current.splice(at, 0, target)
            continue
        }
        if (from !== at) {
            ops.push({ op: 'move', from: `/${from}`, path: `/${at}` })
            current.splice(at, 0, ...current.splice(from, 1))
        }
        ops.push(
            ...diffOps(current[at], target, null).map((op) => ({
                ...op,
                path: `/${at}${op.path}`,
            })),
        )
    }
    return ops
}

// 18.41 — THE KEYED DIFF IS THE SAME OPS HOWEVER IT FINDS THEM, under every reorder at once: rows taken,
// rows added, rows edited, keys written twice and moves in every direction, several to a step — a
// fuzz making one change a step agrees with any implementation by construction. THE REVERT: take a
// move's `from` as its row's rank among the survivors rather than `at` plus the unplaced ones before
// it; the ops part from the reference at the first move past a placed row.
test('a keyed diff answers the reference ops for any reorder, and they rebuild it — 18.41', () => {
    let seed = 7
    const random = (below: number) => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
        return seed % below
    }
    const id = (row: unknown) => (row as { id: number }).id
    for (let step = 0; step < 400; step += 1) {
        const before: { id: number; n: number }[] = []
        for (let at = random(12); at > 0; at -= 1)
            before.push({ id: random(10), n: random(3) })
        const after: { id: number; n: number }[] = []
        for (const row of before)
            if (random(4) !== 0)
                after.splice(random(after.length + 1), 0, {
                    id: row.id,
                    n: random(4) === 0 ? row.n + 1 : row.n,
                })
        for (let added = random(3); added > 0; added -= 1)
            after.splice(random(after.length + 1), 0, { id: random(14), n: 0 })
        const ops = diffOps(before, after, id)
        expect(ops).toEqual(simulatedOps(before, after, id) as never)
        const root = { value: structuredClone(before) }
        applyPatch(
            root,
            ops.map((op) => ({
                ...op,
                path: `/value${op.path}`,
                ...('from' in op ? { from: `/value${op.from}` } : {}),
            })) as never,
        )
        // A key written twice in `before` and once in `after` leaves its other row at the end.
        expect(root.value.slice(0, after.length)).toEqual(after)
    }
})

// 18.41 — A KEYED DIFF READS EACH ROW'S KEY ONCE: a full reverse is the case a scan per position makes
// quadratic, 82 ms at 10,000 rows on the server's follow of every keyed value. Counted as reads of the
// key, which the ops cannot show. THE REVERT: scan `current` from each position for its key, splicing
// it as the ops do; reversing 1,000 rows reads the key 503,500 times, against 2,000.
test('a keyed diff of a reversed list reads each key once — 18.41', () => {
    const before: { id: number }[] = []
    for (let at = 0; at < 1000; at += 1) before.push({ id: at })
    const after = before.slice().reverse()
    let reads = 0
    diffOps(before, after, (row) => {
        reads += 1
        return (row as { id: number }).id
    })
    expect(reads).toBe(2000)
})
