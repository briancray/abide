// 18.26, 18.28 — WHAT A PATCH WROTE, KEPT AS DATA. The one property that matters: the ops, replayed on
// a copy of the value as it stood, make the value as the patch left it — or the sink says it could
// not keep them. Anything else is writes landing somewhere else on a browser, silently.

import { expect, test } from 'bun:test'
import type { PatchOp } from '#shared/reactive/PATCH_SINKS.ts'
import { recordWrites } from '#shared/reactive/recordWrites.ts'
import { applyPatch } from '#ui/applyPatch.ts'

type Row = { id: string; name: string; place: { city: string } }

const rows = (): Row[] => [
    { id: 'ada', name: 'Ada', place: { city: 'London' } },
    { id: 'grace', name: 'Grace', place: { city: 'New York' } },
    { id: 'katherine', name: 'Katherine', place: { city: 'Hampton' } },
]

function replayed(mutate: (list: Row[]) => void): {
    kept: boolean
    same: boolean
    ops: PatchOp[]
} {
    const value = rows()
    const before = structuredClone(value)
    const sink = { ops: [] as PatchOp[], lost: false }
    recordWrites(value, mutate, sink)
    if (sink.lost) return { kept: false, same: false, ops: sink.ops }
    // AS A BROWSER HAS THEM, which is parsed off the wire: the replay puts a pushed row into the copy,
    // and a write after it would otherwise reach back into the ops being inspected.
    const ops = structuredClone(sink.ops)
    applyPatch(before, sink.ops)
    return { kept: true, same: Bun.deepEquals(before, value), ops }
}

test('a nested write is kept at its path', () => {
    const result = replayed((list) => {
        ;(list[1] as Row).place.city = 'Arlington'
    })
    expect(result).toMatchObject({ kept: true, same: true })
    expect(result.ops).toEqual([
        { path: [1, 'place', 'city'], set: 'Arlington' },
    ])
})

// A SPLICE IS ONE CALL, not a write for every element that moved up.
test('a reshape is kept as the one call it was', () => {
    const result = replayed((list) => {
        list.splice(0, 1)
    })
    expect(result).toMatchObject({ kept: true, same: true })
    expect(result.ops).toEqual([{ path: [], call: 'splice', args: [0, 1] }])
})

// THE SNAPSHOT IS TAKEN AT THE WRITE. THE REVERT: keep the pushed row by reference in `snapshot`; the
// push replays carrying the name set after it, and the set then applies to it a second time — the
// same here, but a push of a row later spliced out would carry what it never held when pushed.
test('a row pushed and then written replays as pushed, then written', () => {
    const result = replayed((list) => {
        const row = {
            id: 'dorothy',
            name: 'Dorothy',
            place: { city: 'Hampton' },
        }
        list.push(row)
        ;(list[3] as Row).name = 'Dorothy Vaughan'
    })
    expect(result).toMatchObject({ kept: true, same: true })
    expect((result.ops[0] as { args: Row[] }).args[0]?.name).toBe('Dorothy')
})

// A ROW READ BEFORE ITS ARRAY WAS REORDERED MAY NO LONGER BE AT THE INDEX IT WAS READ FROM. THE
// REVERT: have `pathTo` ignore `at`; the write is kept at index 2 where the row now stands at 1, and
// the replay names the wrong contact.
test('a write through a row read before its array was reordered is not kept', () => {
    const result = replayed((list) => {
        const katherine = list[2] as Row
        list.splice(0, 1)
        katherine.name = 'Katherine Johnson'
    })
    expect(result.kept).toBe(false)
})

test('the same row read again after the reorder is kept at where it stands', () => {
    const result = replayed((list) => {
        list.splice(0, 1)
        ;(list[1] as Row).name = 'Katherine Johnson'
    })
    expect(result).toMatchObject({ kept: true, same: true })
})

test('a sort by a comparator is not kept', () => {
    expect(
        replayed((list) => {
            list.sort((a, b) => b.id.localeCompare(a.id))
        }).kept,
    ).toBe(false)
})
