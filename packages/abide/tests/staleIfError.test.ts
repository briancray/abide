// 6.6 through 6.9 — `staleIfError` KEEPS AN ENTRY PAST ITS `ttl` WHERE NOTHING SUBSCRIBES TO IT, so the
// reach that finds it revalidates it in place rather than starting from nothing, and a revalidation
// that fails answers the value it held. A server's call never subscribes, so without it 6.2 releases
// the entry and a failed refetch has nothing to answer with.

import { expect, test } from 'bun:test'

import { memo, reactive } from '#shared'
import { CALL_ENTRY } from '#shared/reactive/CALL_ENTRY.ts'
import { KEYED_OF } from '#shared/reactive/createMemo.ts'

const entriesOf = (value: unknown): number =>
    (value as { [KEYED_OF]: { entries: Map<string, unknown> } })[KEYED_OF]
        .entries.size
const entryOf = (answer: object): unknown =>
    (answer as { [CALL_ENTRY]?: unknown })[CALL_ENTRY]

// THE REVERT: build `Lifetime` with a `staleMs` of 0 whatever `staleIfError` says; the entry is
// released at its `ttl`, `entries: 0`. And with the kept entry ended where a reach finds it, the
// refetch runs in a fresh entry with nothing to answer, `answered: down`.
test('an entry past its ttl is kept, and a failed revalidation answers what it held — 6.6, 6.8, 6.9', async () => {
    let runs = 0
    const listed = memo(
        async () => {
            runs += 1
            if (runs === 2) throw new Error('down')
            return `list ${runs}`
        },
        { ttl: 20, staleIfError: 10_000 },
    )
    expect(await listed()).toBe('list 1')
    await Bun.sleep(60)
    expect(`entries: ${entriesOf(listed)}`).toBe('entries: 1')
    const answered = await listed().then(
        (value) => value,
        (failure: Error) => failure.message,
    )
    expect(`answered: ${answered}, runs: ${runs}`).toBe(
        'answered: list 1, runs: 2',
    )
    // 15.19 — the failure was transient, so the next reach revalidates again, and lands.
    expect(await listed()).toBe('list 3')
})

// THE REVERT: drop the `expired` release from `Lifetime.sweep`; the kept entry is never let go,
// `entries: 1`.
test('an entry kept past its ttl is released once staleIfError runs out — 6.7', async () => {
    const listed = memo(async () => 'list', { ttl: 20, staleIfError: 40 })
    await listed()
    await Bun.sleep(40)
    expect(`kept: ${entriesOf(listed)}`).toBe('kept: 1')
    await Bun.sleep(80)
    expect(`entries: ${entriesOf(listed)}`).toBe('entries: 0')
})

// THE REVERT: end a kept entry in `outlived` rather than refresh it; the reach starts a fresh entry,
// `same entry: false`.
test('a reach of a kept entry revalidates that entry in place — 6.8', async () => {
    let runs = 0
    const listed = memo(
        async () => {
            runs += 1
            return `list ${runs}`
        },
        { ttl: 20, staleIfError: 10_000 },
    )
    const first = listed()
    await first
    await Bun.sleep(60)
    const second = listed()
    expect(await second).toBe('list 2')
    expect(`same entry: ${entryOf(first) === entryOf(second)}`).toBe(
        'same entry: true',
    )
})

// 11.81 — a value takes no `staleIfError`: it is a source's, declared on the memo. THE REVERT: drop it
// from `SOURCED` in `reactive/index.ts`, and nothing throws.
test('reactive refuses staleIfError — 11.81', () => {
    expect(() => reactive(() => 1, { staleIfError: 10 } as never)).toThrow(
        'memo(fn, { staleIfError })',
    )
})
