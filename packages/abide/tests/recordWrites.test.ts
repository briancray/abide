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
    return replayedOver(rows(), mutate)
}

function replayedOver<Value extends object>(
    value: Value,
    mutate: (value: Value) => void,
): {
    kept: boolean
    same: boolean
    ops: PatchOp[]
} {
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

// A PLACED ROW IS SENT AS IT STANDS WHEN THE CALLBACK RETURNS, so a write under it is in the push and
// not an op of its own. THE REVERT: drop the `placed` answer in `pathTo`; the push carries the tag and
// the kept `push` of it replays a second time (`same: false`, ops 2).
test('a row pushed and then written is sent once, as it stands', () => {
    const result = replayed((list) => {
        list.push({
            id: 'dorothy',
            name: 'Dorothy',
            place: { city: 'Hampton' },
            tags: [] as string[],
        } as Row)
        ;(list[3] as Row & { tags: string[] }).tags.push('NACA')
    })
    expect(result).toMatchObject({ kept: true, same: true })
    expect(result.ops.length).toBe(1)
})

// The push carries the row as it ended, which it no longer is in the value — and the splice after
// it takes it out again, so the replay lands where the server did.
test('a row pushed, written and spliced out replays to the same value', () => {
    const result = replayed((list) => {
        const row = {
            id: 'dorothy',
            name: 'Dorothy',
            place: { city: 'Hampton' },
        }
        list.push(row)
        row.name = 'Dorothy Vaughan'
        list.splice(3, 1)
    })
    expect(result).toMatchObject({ kept: true, same: true })
})

test('a row pushed, then reordered under and written, replays to the same value', () => {
    const result = replayed((list) => {
        list.push({
            id: 'dorothy',
            name: 'Dorothy',
            place: { city: 'Hampton' },
        })
        list.reverse()
        ;(list[0] as Row).place.city = 'Los Angeles'
    })
    expect(result).toMatchObject({ kept: true, same: true })
})

test('an object placed, written, and its parent replaced replays to the same value', () => {
    const result = replayedOver(
        { place: { city: 'London' } as Record<string, unknown> },
        (value) => {
            const inner = { street: 'Marylebone' }
            value.place.inner = inner
            inner.street = 'Baker Street'
            value.place = { city: 'Hampton' }
        },
    )
    expect(result).toMatchObject({ kept: true, same: true })
})

// AN OBJECT IN TWO PLACES IS SENT AS EACH PLACE STANDS WHEN THE CALLBACK RETURNS: a placed row read
// back and put in a second place, a row an assignment puts where another stood, a row pushed twice.
// Each place's copy is taken after every write, so the replay lands where the server's did.
test('a placed row also put somewhere else is kept', () => {
    const result = replayedOver(
        { items: rows() } as { items: Row[]; pinned?: Row },
        (value) => {
            value.items.push({
                id: 'dorothy',
                name: 'Dorothy',
                place: { city: 'Hampton' },
            })
            value.pinned = value.items[3] as Row
            ;(value.items[3] as Row).name = 'Dorothy Vaughan'
        },
    )
    expect(result).toMatchObject({ kept: true, same: true })
})

// A ROW READ BEFORE ITS ARRAY WAS REORDERED MAY NO LONGER BE AT THE INDEX IT WAS READ FROM. THE
// REVERT (for this, the two assignments and the shortened array below): drop the identity read in
// `pathTo`; the write is kept at index 2 where the row now stands at 1, and the replay names the
// wrong contact.
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

// AN ASSIGNMENT MOVES A ROW AS A RESHAPE DOES. With the identity read out of `pathTo`, the write
// through Ada is kept at [0, 'name'] where Grace now stands, and the replay renames Grace.
test('a write through a row an assignment moved is not kept', () => {
    const result = replayed((list) => {
        const ada = list[0] as Row
        const grace = list[1] as Row
        list[0] = grace
        list[1] = ada
        ada.name = 'Ada Lovelace'
    })
    expect(result.kept).toBe(false)
})

test('nor through anything reached under it', () => {
    const result = replayed((list) => {
        const place = (list[0] as Row).place
        list[0] = list[1] as Row
        place.city = 'Marylebone'
    })
    expect(result.kept).toBe(false)
})

test('a swap with nothing written after it is kept', () => {
    const result = replayed((list) => {
        const ada = list[0] as Row
        list[0] = list[1] as Row
        list[1] = ada
    })
    expect(result).toMatchObject({ kept: true, same: true })
})

// THE REVERT (for this and the two beside it): copy each op's value at its write; the second place
// is sent as it stood before the write through the first, and the replay reads `same: false`.
test('a write through a row an assignment placed a second time is kept', () => {
    const result = replayed((list) => {
        const grace = list[1] as Row
        list[0] = grace
        grace.name = 'Grace Hopper'
    })
    expect(result).toMatchObject({ kept: true, same: true })
})

test('a write through a row a shortened array dropped is not kept', () => {
    const result = replayed((list) => {
        const katherine = list[2] as Row
        list.length = 1
        katherine.name = 'Katherine Johnson'
    })
    expect(result.kept).toBe(false)
})

// A ROW PUT BACK WHERE IT STOOD IS PLACED: its path reads true again, and the `push` sends it as it
// stands when the callback returns — so a write under it, through a list reached before the `pop`,
// is already in that copy. THE REVERT: drop the `placed` mark on a reached value in `stored`; the
// write is kept beside the copy that carries it, and the replay holds `z` twice (`same: false`).
test('a write under a row popped and put back is sent in its copy', () => {
    const result = replayedOver(
        [
            { id: 'a', tags: ['x'] },
            { id: 'b', tags: ['y'] },
        ],
        (list) => {
            const tags = (list[1] as { tags: string[] }).tags
            list.push(list.pop() as { id: string; tags: string[] })
            tags.push('z')
        },
    )
    expect(result).toMatchObject({ kept: true, same: true })
})

// 32.33 — NOTHING FROM A PATCH STAYS IN THE VALUE. A `filter` reads its rows through the patch's
// proxies and hands back a new array holding them, and a spread row holds the proxies of what it
// spread. THE REVERT: unwrap only the top of a stored value; the kept row is stored as a proxy
// (`same row: false`), and so is the spread row's place.
test('a value built from what the patch read is stored without its proxies', () => {
    const value = { items: rows() }
    const [ada, , katherine] = value.items as [Row, Row, Row]
    recordWrites(value, (held) => {
        held.items = held.items.filter((row) => row.id !== 'grace')
        held.items[1] = { ...(held.items[1] as Row), name: 'Katherine Johnson' }
    })
    expect(
        `same row: ${value.items[0] === ada}, same place: ${value.items[1]?.place === katherine.place}`,
    ).toBe('same row: true, same place: true')
})

// 18.28 — A RAW ROW THE CALLBACK PLACED IS WRITTEN THROUGH NO PROXY, and is in the push because the
// push is copied when the callback returns. THE REVERT: snapshot each op's value at its write; the
// push carries the name the row was pushed with, and the replay leaves Dorothy unrenamed
// (`same: false`).
test('a write to a row after it was pushed, through no proxy, is in the push', () => {
    const result = replayed((list) => {
        const row = {
            id: 'dorothy',
            name: 'Dorothy',
            place: { city: 'Hampton' },
        }
        list.push(row)
        ;(list[3] as Row).place.city = 'Los Angeles'
        row.name = 'Dorothy Vaughan'
    })
    expect(result).toMatchObject({ kept: true, same: true })
})

// THE ARRAY A `reverse` ANSWERS IS THE ONE IT WAS CALLED ON. THE REVERT: return the raw result; the
// write through it is made to no proxy, and the replay keeps Katherine's old name.
test('a write through the array a reshape answers is kept', () => {
    const result = replayed((list) => {
        ;(list.reverse()[0] as Row).name = 'Katherine Johnson'
    })
    expect(result).toMatchObject({ kept: true, same: true })
})

test('a write to a row pushed twice is kept', () => {
    const result = replayed((list) => {
        const row = {
            id: 'dorothy',
            name: 'Dorothy',
            place: { city: 'Hampton' },
        }
        list.push(row, row)
        ;(list[4] as Row).name = 'Dorothy Vaughan'
    })
    expect(result).toMatchObject({ kept: true, same: true })
})

// A RESHAPE MOVES WHAT IS UNDER AN ARRAY, NOT THE ARRAY. THE REVERT: stale every path through an
// array once it is reshaped, its own included, as the one count of reshapes across the patch did;
// the second push reads its list's path as stale, and the whole value is sent (`kept: false`).
test('two pushes to one nested list are both kept', () => {
    const result = replayedOver({ items: rows() }, (value) => {
        value.items.push({
            id: 'dorothy',
            name: 'Dorothy',
            place: { city: 'Hampton' },
        })
        value.items.push({
            id: 'mary',
            name: 'Mary',
            place: { city: 'Hampton' },
        })
    })
    expect(result).toMatchObject({ kept: true, same: true })
    expect(result.ops.length).toBe(2)
})
