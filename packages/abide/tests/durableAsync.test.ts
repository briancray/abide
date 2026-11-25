// 18.46, 18.47 — A SERVED VALUE KEPT IN A LOG READ ASYNCHRONOUSLY (`store.redis`): a version is named
// by this process as the number after the last it knows and written behind, each append made only
// where that number is still free; two processes naming the same number meet as a conflict, and the
// one that lost applies its change over the other's and writes the result whole. A log shared in
// memory, answering every read a turn later, stands for the server two processes share.

import { expect, test } from 'bun:test'

import { RedisClient } from 'bun'

import { store } from '#server'
import { patchesSince, versionOf } from '#server/versionOf.ts'
import { flushSync, memo } from '#shared'
import type { Logged, LogStore } from '#shared/ledger.ts'
import { KEYED_OF } from '#shared/reactive/createMemo.ts'
import type { Reactive } from '#shared/reactive/Reactive.ts'

const entryOf = (made: unknown): Reactive<unknown> =>
    (made as { [KEYED_OF]: () => Reactive<unknown> })[KEYED_OF]()

/** One log two processes share, every answer a turn late, and a watch each append wakes. */
function sharedLog() {
    const records: Logged<unknown>[] = []
    const listeners = new Set<() => void>()
    const later = async <Value>(value: () => Value): Promise<Value> => {
        await Bun.sleep(1)
        return value()
    }
    const appended = (entry: unknown, at: number): number => {
        records.push({ seq: records.length + 1, at, entry })
        for (const listener of listeners) queueMicrotask(listener)
        return records.length
    }
    const face = (): LogStore & {
        get: () => undefined
        set: () => void
    } => ({
        get: () => undefined,
        set: () => {},
        append: (entry, _key, at) => later(() => appended(entry, at)),
        appendAt: (entry, expected, at) =>
            later(() =>
                records.length === expected ? appended(entry, at) : undefined,
            ),
        since: (seq) => later(() => records.slice(seq, seq + 256)),
        last: () => later(() => records.length),
        position: () => 0,
        trim: () => {},
        watch: (changed) => {
            listeners.add(changed)
            return () => listeners.delete(changed)
        },
    })
    return { records, face }
}

const shelfOver = (kept: unknown) =>
    memo((_none: undefined) => ['dune'], {
        global: true,
        store: () => kept as never,
    })

/** Turns until `done` holds, or two seconds. */
async function until(done: () => boolean): Promise<void> {
    const deadline = Date.now() + 2_000
    while (!done() && Date.now() < deadline) {
        await Bun.sleep(5)
        flushSync()
    }
}

// THE REVERT: answer `null` from `chainOf` where the log's `last` is a promise (the sync-only chain
// this replaced); the reopened value's version is a process-counter number, not 2, and no record of
// the patch is in the log.
test('a log read asynchronously records each change, and a reopened value stands at its last — 18.46', async () => {
    const { records, face } = sharedLog()
    const first = shelfOver(face())
    await first()
    const before = entryOf(first)
    versionOf(before)
    await until(() => records.length === 1)
    first.patch((titles: string[]) => {
        titles.push('emma')
    })
    flushSync()
    const named = versionOf(before)
    await until(() => records.length === 2)

    const reopened = shelfOver(face())
    expect(await reopened()).toEqual(['dune'])
    const after = entryOf(reopened)
    versionOf(after)
    await until(() => records.length === 3)
    expect(
        `named: ${named}, records: ${records.length}, patch: ${JSON.stringify(records[1]?.entry)}`,
    ).toBe(
        'named: 2, records: 3, patch: {"ops":[{"op":"add","path":"/-","value":"emma"}]}',
    )
})

// 18.47 — BOTH PROCESSES NAME VERSION 2 before either append lands: the log takes one, and the other
// applies its change over that one's and writes the value whole at 3, which both then stand at. THE
// REVERT: drop `reconcile`'s merge, taking the log's value as it stands; the loser's change is lost,
// both standing at `clay,dune`.
test('two processes naming one version meet as a conflict, and both stand at the merge — 18.47', async () => {
    const { records, face } = sharedLog()
    const here = shelfOver(face())
    const there = shelfOver(face())
    await here()
    await there()
    const hereEntry = entryOf(here)
    const thereEntry = entryOf(there)
    versionOf(hereEntry)
    await until(() => records.length === 1)
    versionOf(thereEntry)
    await until(() => versionOf(thereEntry) === 1)
    here.patch((titles: string[]) => {
        titles.push('emma')
    })
    there.patch((titles: string[]) => {
        titles.push('clay')
    })
    flushSync()
    const hereNamed = versionOf(hereEntry)
    const thereNamed = versionOf(thereEntry)
    await until(
        () =>
            (hereEntry.peek() as string[]).length === 3 &&
            (thereEntry.peek() as string[]).length === 3 &&
            versionOf(hereEntry) === versionOf(thereEntry),
    )
    const sorted = (values: unknown) => [...(values as string[])].sort()
    expect(
        `named: ${hereNamed},${thereNamed}; here: ${sorted(hereEntry.peek())}; there: ${sorted(thereEntry.peek())}; at: ${versionOf(hereEntry)},${versionOf(thereEntry)}`,
    ).toBe('named: 2,2; here: clay,dune,emma; there: clay,dune,emma; at: 3,3')
    // A follower standing at the number the loser named is sent the value, not the winner's patch.
    const loser =
        (records[1]?.entry as { ops: { value: string }[] }).ops[0]?.value ===
        'emma'
            ? thereEntry
            : hereEntry
    expect(patchesSince(loser, 2)).toBeUndefined()
})

const URL = process.env.ABIDE_REDIS_URL

// 18.46, 18.45 — AGAINST A REAL SERVER, one served value on two connections: a change through one is
// appended by the script, heard through the keyspace watch on the other, and applied at its number.
// THE REVERT: drop `unwatchStore` from `chainOf`; the value's own re-read races the log, each undoing
// the other as a record of its own, and `emma` is appended a few hundred times in two seconds.
test.skipIf(URL === undefined)(
    'a value kept in redis is appended to, and heard on another connection — 18.46',
    async () => {
        const name = `durable-redis-${Date.now()}`
        const clients = [
            new RedisClient(URL as string),
            new RedisClient(URL as string),
        ]
        const here = shelfOver(store.redis(clients[0] as RedisClient, name))
        const there = shelfOver(store.redis(clients[1] as RedisClient, name))
        await here()
        await there()
        const hereEntry = entryOf(here)
        const thereEntry = entryOf(there)
        versionOf(hereEntry)
        await until(() => versionOf(hereEntry) === 1)
        versionOf(thereEntry)
        await until(() => versionOf(thereEntry) === 1)
        here.patch((titles: string[]) => {
            titles.push('emma')
        })
        flushSync()
        const named = versionOf(hereEntry)
        await until(() => (thereEntry.peek() as string[]).length === 2)
        expect(
            `named: ${named}; there: ${thereEntry.peek()} at ${versionOf(thereEntry)}`,
        ).toBe('named: 2; there: dune,emma at 2')
        for (const client of clients) client.close()
    },
)
