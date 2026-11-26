// 13.7 — EVERY MARK BEFORE ANY RELOAD. A memo reached from another memo's body is tracked by nothing
// (11.6), so a refresh over a tag both carry reloads the derived one first — it was reached first —
// and, were its source not marked yet, its body read what the source held and its follower heard the
// write one refresh late.
//
// THE REVERT: in `refreshAll`, reload each cell as the loop reaches it (one pass, `markIn` or
// `refreshOne`); the follower hears nothing, `nothing` where `20` is due, in both cases. Marking only
// the unread entries first passes the first case and fails the second.

import { expect, test } from 'bun:test'

import { memo, refresh } from '#shared'

const next = (reader: ReadableStreamDefaultReader<unknown>) =>
    Promise.race([
        reader.read().then((read) => read.value),
        Bun.sleep(200).then(() => 'nothing'),
    ])

test("a refresh over a tag reaches a derived memo's follower with the write that moved its source — 13.7", async () => {
    let base = 1
    const source = memo(() => base, { tags: ['ledger-a'], global: true })
    const derived = memo(async () => (await source()) * 10, {
        tags: ['ledger-a'],
        global: true,
    })
    const reader = derived.readable(undefined).getReader()
    expect(await next(reader)).toBe(10)
    base = 2
    refresh({ tags: ['ledger-a'] })
    expect(await next(reader)).toBe(20)
})

test('and where the source is followed as well — 13.7', async () => {
    let base = 1
    const source = memo(() => base, { tags: ['ledger-b'], global: true })
    const derived = memo(async () => (await source()) * 10, {
        tags: ['ledger-b'],
        global: true,
    })
    const reader = derived.readable(undefined).getReader()
    expect(await next(reader)).toBe(10)
    const sourceReader = source.readable(undefined).getReader()
    expect(await next(sourceReader)).toBe(1)
    base = 2
    refresh({ tags: ['ledger-b'] })
    expect(await next(reader)).toBe(20)
    expect(await next(sourceReader)).toBe(2)
})
