// 13.6, 13.7 AND 13.9 — THE BARE SELECTION, in a browser: `busy()`, `ready()`, `refresh()` and
// `invalidate()` with nothing named sweep every LOAD in reach — a value whose producer has started
// one. What is gated is the WORK — body runs, what a follower was sent, how often a guard woke —
// because every one of these reads the right value with the sweep reaching too much or too little.
//
// A FILE OF ITS OWN because the sweep is process-wide: every producer another test file left
// standing would be in reach, and each test here settles what it starts so the next one's
// `busy()` is not answering about it. The server's arm, scope and `global`, is in `scope.test.ts`.

import { beforeAll, expect, test } from 'bun:test'

import {
    busy,
    flushSync,
    invalidate,
    reactive,
    ready,
    refresh,
    watch,
} from '#shared'
import { online } from '#shared/online.ts'
import { CELL } from '#shared/reactive/CELL.ts'
import { FOLLOWED } from '#shared/reactive/FOLLOWED.ts'
import { unfileProducers } from '#shared/reactive/Reactive.ts'

function cellOf<Fields>(value: unknown): Fields {
    return (value as { [CELL]: Fields })[CELL]
}

// A FILE OF ITS OWN IS NOT A PROCESS OF ITS OWN: under `bun run test:serial` every file before this
// one ran here, and what each left filed is in this sweep — the principal's document, a stream
// another file dropped and nothing has collected — and `busy()` reads true while they ask.
// `reachable`'s held answers no longer need it: their keyed `ttl` lifetimes stopped counting as
// readers to 13.7. THE REVERT: drop this hook; after `principalEarly.test.ts` in one process the
// guard reads `busy saw: true,true,true`.
beforeAll(unfileProducers)

// Loads settled by hand, so a case can hold a set of values busy between two lines.
function deferredLoads(): {
    load: () => Promise<number>
    settleAll: (value: number) => void
} {
    const settles: ((value: number) => void)[] = []
    return {
        load: () =>
            new Promise<number>((resolve) => {
                settles.push(resolve)
            }),
        settleAll: (value) => {
            for (const settle of settles.splice(0)) settle(value)
        },
    }
}

// 13.6 AND 7.3 — A BARE `invalidate()` MATCHES PRODUCERS, AND LOADS NOTHING. The value with no
// producer is followed by a browser, which is the one place an invalidate of it is not inert (7.10):
// swept, every follower would be told its copy is stale.
//
// THE REVERTS: filing every value in `createReactive` rather than only a load sends the follower
// on — `followers told: 1`; the bare branch of `invalidateOver` running `refreshOne` loads at once —
// `runs before a read: 2`; and dropping the bare branch leaves the mark unmade — `runs after a read: 1`.
test('a bare invalidate marks every load, starts none of them, and skips a value with no producer — 13.6, 7.3', async () => {
    let runs = 0
    const loaded = reactive(async () => {
        runs += 1
        return runs
    })
    await loaded
    const published = reactive(0)
    published.set(5)
    let told = 0
    FOLLOWED.set(
        cellOf<object>(published),
        new Set([
            () => {
                told += 1
            },
        ]),
    )
    const stop = watch(() => {
        loaded()
    })
    invalidate()
    expect(`followers told: ${told}`).toBe('followers told: 0')
    expect(`runs before a read: ${runs}`).toBe('runs before a read: 1')
    expect(published()).toBe(5)
    loaded.peek()
    expect(`runs after a read: ${runs}`).toBe('runs after a read: 2')
    stop()
})

// 13.7 — A BARE `refresh()` RELOADS WHAT SOMETHING READS AND MARKS THE REST.
//
// THE REVERT: reloading every value the sweep reaches, subscribed or not — `unread runs before a
// read: 2`.
test('a bare refresh reloads the subscribed loads and marks the rest — 13.7', async () => {
    let readRuns = 0
    let unreadRuns = 0
    const read = reactive(async () => {
        readRuns += 1
        return readRuns
    })
    const unread = reactive(async () => {
        unreadRuns += 1
        return unreadRuns
    })
    await read
    await unread
    const stop = watch(() => {
        read()
    })
    refresh()
    flushSync()
    expect(`read runs: ${readRuns}`).toBe('read runs: 2')
    expect(`unread runs before a read: ${unreadRuns}`).toBe(
        'unread runs before a read: 1',
    )
    expect(await unread).toBe(2)
    stop()
})

// A SYNCHRONOUS DERIVATION IS NOT A LOAD: a bare refresh reloads the load it reads, and the
// derivation recomputes when that lands rather than being rerun beside it.
//
// THE REVERT: filing every value with a body where it is built — `derivation runs on the refresh: 1`,
// a recompute of what its source still says.
test('a bare refresh reruns no synchronous derivation — 13.6', async () => {
    let loads = 0
    let derivationRuns = 0
    const source = reactive(async () => {
        loads += 1
        return 2
    })
    const doubled = reactive(() => {
        derivationRuns += 1
        return source() * 2
    })
    const stop = watch(() => {
        doubled()
    })
    await source
    flushSync()
    const before = derivationRuns
    refresh()
    flushSync()
    const onRefresh = derivationRuns - before
    stop()
    // Landed before the next test, whose `busy()` would otherwise answer about it.
    await source
    expect(`loads: ${loads}`).toBe('loads: 2')
    expect(`derivation runs on the refresh: ${onRefresh}`).toBe(
        'derivation runs on the refresh: 0',
    )
})

// 13.3 AND 13.9 — ONE SIGNAL FOR THE BARE SELECTION. A page spinner over ten loads holds one edge,
// never one per entry, and wakes twice for the ten reloading together: once as they go busy and once
// as they come back.
//
// THE REVERTS: `markProbes` not marking `EVERY_PRODUCER` leaves both guards on their first answer —
// `busy saw: false`; answering a tracked bare probe through each entry's own member subscribes the
// guard entry by entry, and a member probe runs what an earlier sweep only marked (3.2) —
// `busy saw: true,true,true,true,false`, five answers where three are due.
test('a guard over the bare selection subscribes once and wakes twice for n reloads — 13.3, 13.9', async () => {
    const loads = deferredLoads()
    const values = []
    for (let index = 0; index < 10; index += 1)
        values.push(reactive(() => loads.load()))
    // The ten are in flight from construction; land them so the guards open on a settled scope.
    loads.settleAll(1)
    await Bun.sleep(1)
    flushSync()
    const readers = values.map((value) =>
        watch(() => {
            value()
        }),
    )
    const busySaw: boolean[] = []
    const readySaw: boolean[] = []
    const guardBusy = watch(() => {
        busySaw.push(busy())
    })
    const guardReady = watch(() => {
        readySaw.push(ready())
    })
    let probeReaders = 0
    for (const value of values)
        probeReaders += cellOf<{ probeReaders: unknown[] }>(value).probeReaders
            .length
    expect(`probe readers: ${probeReaders}`).toBe('probe readers: 0')

    // Each value is subscribed through its reader, so the refresh reloads all ten.
    refresh()
    flushSync()
    loads.settleAll(2)
    await Bun.sleep(1)
    flushSync()
    guardBusy()
    guardReady()
    for (const stop of readers) stop()
    expect(`busy saw: ${busySaw.join(',')}`).toBe('busy saw: false,true,false')
    // A refresh serves what it holds (7.4), so `ready` stays true — and wakes on the same two
    // moves, the signal being the selection's rather than one per probe.
    expect(`ready saw: ${readySaw.join(',')}`).toBe('ready saw: true,true,true')
})

// THE DOCS' RECONNECT: `watch(() => { if (online) refresh() })` in a layout. Coming back online
// reloads what a reader holds and marks what nobody does; going offline runs nothing.
//
// THE REVERTS: the bare form refused, as it was, throws out of the layout's watch on its first run;
// and a bare refresh reloading everything it reaches runs the unread one twice before anything
// reads it — `unread runs before a read: 3`, one per time the watch saw `online` true.
test('refreshing on reconnect reloads what is read and marks the rest', async () => {
    let ordersRuns = 0
    let unreadRuns = 0
    const orders = reactive(async () => {
        ordersRuns += 1
        return ordersRuns
    })
    const archive = reactive(async () => {
        unreadRuns += 1
        return unreadRuns
    })
    await orders
    await archive
    const page = watch(() => {
        orders()
    })
    const layout = watch(() => {
        if (online()) refresh()
    })
    flushSync()
    window.dispatchEvent(new Event('offline'))
    flushSync()
    const offline = online()
    const beforeReconnect = ordersRuns
    window.dispatchEvent(new Event('online'))
    flushSync()
    layout()
    page()
    expect(`online while offline: ${offline}`).toBe(
        'online while offline: false',
    )
    expect(`orders runs on reconnect: ${ordersRuns - beforeReconnect}`).toBe(
        'orders runs on reconnect: 1',
    )
    expect(`unread runs before a read: ${unreadRuns}`).toBe(
        'unread runs before a read: 1',
    )
    expect(await archive).toBe(2)
})

// 13.7 OVER A KEYED `ttl` — AN ENTRY'S LIFETIME IS NOT A READER. The mirror `Lifetime.follow`
// subscribes to every entry of a keyed value declaring `ttl` (11.45) hears its productions, and a
// bare `refresh()` that counted it as something reading the entry reloaded an entry nothing reads.
//
// THE REVERT: count every reader in `refreshOver`'s subscribed test, the lifetime included —
// `unread entry loads before a read: 2`.
test('a bare refresh marks a keyed ttl entry nothing reads rather than reloading it — 13.7', async () => {
    let loads = 0
    const keyed = reactive(
        async (args: { id: number }) => {
            loads += 1
            return args.id * 10 + loads
        },
        { ttl: 60_000 },
    )
    const entry = keyed({ id: 1 })
    await entry
    refresh()
    flushSync()
    expect(`unread entry loads before a read: ${loads}`).toBe(
        'unread entry loads before a read: 1',
    )
    expect(await entry).toBe(12)
})
