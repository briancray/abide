// 18.42-18.44 — A SERVED VALUE'S CHANGES KEPT IN ITS STORE'S LOG: each change is a record whose number
// is the version, and a process opening on the store again stands at the version the last one left,
// so a follower reconnecting after a restart is sent the records past the version it names.

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'

import { database, store } from '#server'
import { patchesSince, versionOf } from '#server/versionOf.ts'
import { flushSync, memo } from '#shared'
import { keyedOf } from '#shared/reactive/createMemo.ts'
import type { Reactive } from '#shared/reactive/Reactive.ts'

const entryOf = (made: unknown): Reactive<unknown> =>
    (keyedOf(made) as () => Reactive<unknown>)()

// THE REVERT: mint versions from the process counter in `versionOf` whatever the store; the reopened
// memo's version is a new number, and `patches since` the old one is `undefined`.
test('a restart over the same store keeps the version, and the patches since — 18.42, 18.43', async () => {
    const db = new Database(':memory:')
    const kept = store.sqlite(db, 'shelf')
    const shelf = () =>
        memo(() => ['dune'], {
            global: true,
            store: () => kept,
        })

    const first = shelf()
    await first()
    const before = entryOf(first)
    const opened = versionOf(before)
    first.patch((titles: string[]) => {
        titles.push('emma')
    })
    flushSync()
    const patched = versionOf(before)
    await Bun.sleep(5)

    const reopened = shelf()
    expect(await reopened()).toEqual(['dune', 'emma'])
    const after = entryOf(reopened)
    expect(
        `step: ${patched - opened}, kept: ${versionOf(after) === patched}`,
    ).toBe('step: 1, kept: true')
    expect(patchesSince(after, opened)).toEqual({
        ops: [{ op: 'add', path: '/-', value: 'emma' }],
        replaced: false,
    })
})

// 18.44 — A FOLLOWER BEHIND THE WINDOW is sent the value, never a gap: past the records kept, the log
// answers nothing it can patch from. THE REVERT: drop the gap test from `DurableChain.since`; the ops
// past the trim are handed on as if nothing was missed.
test('a follower behind the kept records is sent the value — 18.44', async () => {
    const db = new Database(':memory:')
    const kept = store.sqlite(db, 'counter')
    const counter = memo(() => ({ n: 0 }), {
        global: true,
        store: () => kept,
    })
    await counter()
    const entry = entryOf(counter)
    const opened = versionOf(entry)
    for (let n = 1; n <= 200; n += 1) {
        counter.set({ n })
        flushSync()
        versionOf(entry)
    }
    expect(patchesSince(entry, opened)).toBeUndefined()
    // 18.49 — a `set`'s diff, and so a replacement.
    expect(patchesSince(entry, versionOf(entry) - 1)).toEqual({
        ops: [{ op: 'replace', path: '/n', value: 200 }],
        replaced: true,
    })
})

// 18.45 — A CHANGE ANOTHER PROCESS MAKES REACHES THIS ONE'S VALUE through the store's log, at the
// version that process minted, two openers of one file standing for two processes. THE REVERT: drop
// the watch `chainOf` sets on the log; the second process never hears the patch, `heard: dune`.
test("a change made through another connection reaches this one's value at its version — 18.45", async () => {
    const file = `${process.env.TMPDIR ?? '/tmp'}/abide-durable-${Date.now()}.sqlite`
    const one = database(file)
    const two = database(file)
    const shelfOver = (opener: typeof one) =>
        memo(() => ['dune'], {
            global: true,
            store: () => store.sqlite(opener, 'shelf'),
        })
    const here = shelfOver(one)
    const there = shelfOver(two)
    await here()
    await there()
    const hereEntry = entryOf(here)
    const thereEntry = entryOf(there)
    versionOf(hereEntry)
    versionOf(thereEntry)
    here.patch((titles: string[]) => {
        titles.push('emma')
    })
    flushSync()
    const minted = versionOf(hereEntry)
    const deadline = Date.now() + 3_000
    while (
        (thereEntry.peek() as string[]).length < 2 &&
        Date.now() < deadline
    ) {
        await Bun.sleep(50)
        flushSync()
    }
    expect(
        `heard: ${thereEntry.peek()}, same version: ${versionOf(thereEntry) === minted}`,
    ).toBe('heard: dune,emma, same version: true')
    one.close()
    two.close()
})
