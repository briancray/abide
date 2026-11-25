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
