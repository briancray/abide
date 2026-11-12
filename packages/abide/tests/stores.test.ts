// THE SHIPPED STORES (RULEBOOK 8.22 through 8.40). Each is a `Store` an app would otherwise write by
// hand, so the claims are about what lands in the value: a restore, a miss, and a re-read when
// another document writes. `store.indexedDB` and the cookie a server renders from are a browser's to
// show, in `e2e/stores.spec.ts`; here IndexedDB is absent, which is 8.35's inert case.

import { Database } from 'bun:sqlite'
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'

import type { RedisClient } from 'bun'

import * as store from '#server/stores.ts'
import { flushSync, reactive } from '#shared'
import { COOKIES, Cookies } from '#shared/cookies.ts'

// A SCOPED NAME, so every key below carries the prefix 8.29 adds and the cookie name has to encode
// the `@` and `/` a token refuses.
const APP = '@crm/web'
const appAsFound = process.env.APP_NAME
beforeAll(() => {
    process.env.APP_NAME = APP
})
afterAll(() => {
    if (appAsFound === undefined) delete process.env.APP_NAME
    else process.env.APP_NAME = appAsFound
})

const slotAsFound = COOKIES.current
afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    COOKIES.current = slotAsFound
})

const isNumber = (value: unknown): number => {
    if (typeof value !== 'number') throw new Error('not a number')
    return value
}

const KEPT_FOREVER = { ttl: Number.POSITIVE_INFINITY }

// 8.22 AND 8.28: A WRITE IS KEPT, AS JSON, AND THE NEXT VALUE BUILT OVER THE KEY OPENS ON IT.
test('store.web keeps a value in localStorage and a new value restores it — 8.22, 8.28', () => {
    const first = reactive(1, { store: store.web<number>('count') })
    first.set(7)
    expect(JSON.parse(localStorage.getItem(`${APP}:count`) ?? 'null')).toEqual({
        value: 7,
        expires: null,
    })
    const second = reactive(1, { store: store.web<number>('count') })
    expect(`restored: ${second()}`).toBe('restored: 7')
    expect(`session: ${sessionStorage.getItem(`${APP}:count`)}`).toBe(
        'session: null',
    )
})

test('store.web keeps a value in sessionStorage where the area is session — 8.22', () => {
    reactive(1, { store: store.web<number>('tab', { area: 'session' }) }).set(3)
    expect(`local: ${localStorage.getItem(`${APP}:tab`)}`).toBe('local: null')
    const again = reactive(1, {
        store: store.web<number>('tab', { area: 'session' }),
    })
    expect(`restored: ${again()}`).toBe('restored: 3')
})

// 8.23: NO WEB STORAGE, AS ON A SERVER, IS A STORE THAT IS NEVER THERE — the initial value lands
// and nothing throws.
test('store.web is inert where there is no Web Storage — 8.23', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'localStorage',
    ) as PropertyDescriptor
    Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
    })
    try {
        const kept = store.web<number>('count')
        expect(`get: ${kept.get()}`).toBe('get: undefined')
        kept.set(4, KEPT_FOREVER)
        const value = reactive(2, { store: kept })
        expect(`value: ${value()}`).toBe('value: 2')
    } finally {
        Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
})

// 8.24: ANOTHER DOCUMENT'S WRITE IS READ BACK. The `storage` event is the browser's report of one,
// and the value re-reads `get` (8.20) — an event for another key, or another area, is not news.
//
// THE REVERT: have `watch` answer a no-op stop without listening, and `after: 1` where `after: 9`.
test('store.web follows another document’s write through the storage event — 8.24', () => {
    const key = `${APP}:shared`
    const value = reactive(1, { store: store.web<number>('shared') })
    expect(`before: ${value()}`).toBe('before: 1')
    localStorage.setItem(key, JSON.stringify({ value: 5, expires: null }))
    dispatchEvent(
        new StorageEvent('storage', {
            key: 'other',
            storageArea: localStorage,
        }),
    )
    dispatchEvent(
        new StorageEvent('storage', { key, storageArea: sessionStorage }),
    )
    flushSync()
    expect(`unrelated: ${value()}`).toBe('unrelated: 1')
    localStorage.setItem(key, JSON.stringify({ value: 9, expires: null }))
    dispatchEvent(
        new StorageEvent('storage', { key, storageArea: localStorage }),
    )
    flushSync()
    expect(`after: ${value()}`).toBe('after: 9')
})

// 8.26: WHAT A VALUE'S `ttl` SAYS IS KEPT BESIDE IT. A restore after the deadline is a miss, and the
// entry is removed rather than read past on every visit.
//
// THE REVERT: drop the `expires` test from `storedValue` and `KeptText.read`, and `after the
// deadline: 3, 3, 3` where `undefined, undefined, undefined` is due.
test('the shipped stores answer a miss past the ttl a value was written with — 8.26', async () => {
    COOKIES.current = jarOf('')
    const web = store.web<number>('brief')
    const sqlite = store.sqlite<number>(new Database(':memory:'), 'brief')
    const cookie = store.cookies<number>('brief')
    web.set(3, { ttl: 20 })
    sqlite.set(3, { ttl: 20 })
    cookie.set(3, { ttl: 20 })
    expect(`before: ${web.get()}, ${sqlite.get()}, ${cookie.get()}`).toBe(
        'before: 3, 3, 3',
    )
    await Bun.sleep(40)
    expect(
        `after the deadline: ${web.get()}, ${sqlite.get()}, ${cookie.get()}`,
    ).toBe('after the deadline: undefined, undefined, undefined')
    expect(`removed: ${localStorage.getItem(`${APP}:brief`)}`).toBe(
        'removed: null',
    )
})

// 8.27: A RESTORE SKIPS THE VALUE'S `schema` (8.5), SO A SHIPPED STORE RUNS ITS OWN. What it refuses
// is a miss, and the value lands its initial value rather than an entry an older build wrote.
//
// THE REVERT: return `kept.value` from `storedValue` without running the schema, and
// `value: not a number` where `value: 1` is due.
test('a shipped store’s schema turns a value it refuses into a miss — 8.27', () => {
    localStorage.setItem(
        `${APP}:count`,
        JSON.stringify({ value: 'not a number', expires: null }),
    )
    const value = reactive(1, {
        store: store.web('count', { schema: isNumber }),
    })
    expect(`value: ${value()}`).toBe('value: 1')

    const db = new Database(':memory:')
    store.sqlite<string>(db, 'count').set('not a number', KEPT_FOREVER)
    const server = reactive(1, {
        store: store.sqlite(db, 'count', { schema: isNumber }),
    })
    expect(`server: ${server()}`).toBe('server: 1')
})

// 8.25: A ROW PER KEY IN A TABLE THE STORE MAKES, one connection per path however many stores name it.
test('store.sqlite keeps a value in a row of its table, made where missing — 8.25, 8.28', () => {
    const path = `${Bun.env.TMPDIR ?? '/tmp'}/abide-sqlite-store-${process.pid}.db`
    try {
        const first = reactive(() => ({ list: [1, 2] }), {
            store: store.sqlite<{ list: number[] }>(path, 'doc', {
                table: 'kept',
            }),
        })
        expect(first()).toEqual({ list: [1, 2] })
        const db = new Database(path)
        const row = db
            .query('SELECT value, expires FROM kept WHERE key = ?')
            .get(`${APP}:doc`)
        expect(row).toEqual({ value: '{"list":[1,2]}', expires: null })
        db.close()
        let runs = 0
        const second = reactive(
            () => {
                runs += 1
                return { list: [] as number[] }
            },
            {
                store: store.sqlite<{ list: number[] }>(path, 'doc', {
                    table: 'kept',
                }),
            },
        )
        expect(second()).toEqual({ list: [1, 2] })
        expect(`runs: ${runs}`).toBe('runs: 0')
        expect(() =>
            store.sqlite(path, 'doc', { table: 'kept; DROP TABLE kept' }),
        ).toThrow('is not an SQL identifier')
    } finally {
        for (const suffix of ['', '-wal', '-shm'])
            Bun.file(`${path}${suffix}`)
                .delete()
                .catch(() => {})
    }
})

// 8.29: TWO APPS SHARING ONE PLACE KEEP TWO VALUES. One origin's `localStorage` is every app served
// from it — two dev servers on one port, in turn — and one SQLite file or one Redis is any app given
// its path.
//
// THE REVERT: have `storeKey` answer `key` alone, and `ledger: 7, 7` where `ledger: undefined,
// undefined` is due.
test('a shipped store keeps its key under the app’s name — 8.29', () => {
    const db = new Database(':memory:')
    store.web<number>('count').set(7, KEPT_FOREVER)
    store.sqlite<number>(db, 'count').set(7, KEPT_FOREVER)
    process.env.APP_NAME = 'ledger'
    try {
        const web = store.web<number>('count').get()
        const sqlite = store.sqlite<number>(db, 'count').get()
        expect(`ledger: ${web}, ${sqlite}`).toBe('ledger: undefined, undefined')
    } finally {
        process.env.APP_NAME = APP
    }
    expect(`${APP}: ${store.web<number>('count').get()}`).toBe(`${APP}: 7`)
})

// 8.30: A RE-READ OF THE TEXT A STORE ALREADY HOLDS IS NOT NEWS. A `watch` that echoes the store's own
// write (Redis's keyspace channel, a cookie change) re-reads it, and a fresh `JSON.parse` of the
// same text is a new reference the default identity (5.4) wakes every reader for.
//
// THE REVERT: drop the `text !== this.text` test in `KeptText.read`, so every read parses afresh;
// the reader runs 2 times after an echo of the value it already holds, where 1 is due.
test('a store re-reading unchanged text wakes no reader — 8.30', () => {
    const key = `${APP}:layout`
    const value = reactive(
        { wide: false },
        {
            store: store.web<{ wide: boolean }>('layout'),
        },
    )
    value.set({ wide: true })
    let runs = 0
    const reader = reactive(() => {
        runs += 1
        return value().wide
    })
    expect(`read: ${reader()}, runs: ${runs}`).toBe('read: true, runs: 1')
    dispatchEvent(
        new StorageEvent('storage', { key, storageArea: localStorage }),
    )
    flushSync()
    reader()
    expect(`runs after an echo: ${runs}`).toBe('runs after an echo: 1')
})

// 8.32: A FINITE `ttl` IS REDIS'S OWN EXPIRY AS WELL AS THE ENVELOPE'S, and forever is no expiry at
// all. 8.33: `watch` subscribes to the key's keyspace channel, in the database the client selected,
// on one duplicate connection however many values watch.
//
// A RECORDING CLIENT stands in for a server, which this machine is not promised to have; what it
// records is the commands a Redis would be sent.
test('store.redis writes with Redis’s own expiry and follows its keyspace channel — 8.31, 8.32, 8.33', async () => {
    const client = recordingRedis()
    const kept = store.redis<number>(client as unknown as RedisClient, 'count')
    await kept.set(4, { ttl: 1500 })
    await kept.set(5, KEPT_FOREVER)
    expect(client.commands).toEqual([
        ['SET', `${APP}:count`, 'PX', '1500'],
        ['SET', `${APP}:count`],
    ])
    expect(client.held.get(`${APP}:count`)).toBe('{"value":5,"expires":null}')
    expect(`get: ${await kept.get()}`).toBe('get: 5')

    let heard = 0
    const stop = kept.watch?.(() => {
        heard += 1
    })
    store
        .redis<number>(client as unknown as RedisClient, 'other')
        .watch?.(() => {})
    await Bun.sleep(0)
    expect(client.subscribed).toEqual([
        `__keyspace@3__:${APP}:count`,
        `__keyspace@3__:${APP}:other`,
    ])
    expect(`duplicates: ${client.duplicates}`).toBe('duplicates: 1')
    client.publish(`__keyspace@3__:${APP}:count`, 'set')
    expect(`heard: ${heard}`).toBe('heard: 1')
    stop?.()
    await Bun.sleep(0)
    client.publish(`__keyspace@3__:${APP}:count`, 'set')
    expect(`heard after stop: ${heard}`).toBe('heard after stop: 1')
})

// 8.37, 8.38: A COOKIE IS WRITTEN THROUGH `cookies()`, under a name the app's carries encoded, for
// the `ttl` as `Max-Age` — forever as the 400 days a browser honors at most.
test('store.cookies writes through cookies() with the ttl as Max-Age — 8.37, 8.38', () => {
    const lines: string[] = []
    COOKIES.current = jarOf('', lines)
    const kept = store.cookies<string>('theme', { sameSite: 'strict' })
    const named = encodeURIComponent(`${APP}:theme`)
    kept.set('dark', { ttl: 90_000 })
    kept.set('dark', KEPT_FOREVER)
    expect(lines.length).toBe(2)
    expect(lines[0]).toStartWith(`${named}=`)
    expect(lines[0]).toContain('; Max-Age=90;')
    expect(lines[0]).toContain('; SameSite=Strict')
    expect(lines[1]).toContain(`; Max-Age=${400 * 24 * 60 * 60};`)
    // A request carrying the cookie restores from it — the page a server renders opens on it.
    COOKIES.current = jarOf(
        `${named}=${encodeURIComponent('{"value":"light","expires":null}')}`,
    )
    const theme = reactive('system', { store: store.cookies<string>('theme') })
    expect(`rendered: ${theme()}`).toBe('rendered: light')
})

// 8.39: A COOKIE A BROWSER WOULD DROP IS A WRITE THAT FAILS, not one that silently is not kept.
//
// THE REVERT: drop the size test from `set`, and `lines: 1` where `lines: 0` is due — the line a
// browser would throw away, sent anyway.
test('store.cookies refuses a value its cookie cannot hold — 8.39', () => {
    const lines: string[] = []
    COOKIES.current = jarOf('', lines)
    const kept = store.cookies<string>('note')
    expect(() => kept.set('x'.repeat(4096), KEPT_FOREVER)).toThrow(
        'past the 4096 a browser keeps',
    )
    expect(`lines: ${lines.length}`).toBe('lines: 0')
})

// 8.35: NO INDEXEDDB, AS ON A SERVER AND IN THIS EMULATOR, IS A STORE THAT IS NEVER THERE.
test('store.indexedDB is inert where there is no IndexedDB — 8.35', async () => {
    expect(`emulated: ${typeof indexedDB}`).toBe('emulated: undefined')
    const kept = store.indexedDB<number>('count')
    await kept.set(4, KEPT_FOREVER)
    expect(`get: ${await kept.get()}`).toBe('get: undefined')
    const value = reactive(2, { store: kept })
    expect(`value: ${value()}`).toBe('value: 2')
})

/** A server-side jar over `header`, its `set-cookie` lines pushed onto `lines`. */
function jarOf(header: string, lines: string[] = []): () => Cookies {
    const jar = new Cookies(header, (line) => lines.push(line), false)
    return () => jar
}

/** The commands a Redis client is sent, and the messages a subscriber would hear, in memory. */
function recordingRedis() {
    const held = new Map<string, string>()
    const listeners = new Map<string, Set<() => void>>()
    const recorder = {
        held,
        commands: [] as string[][],
        subscribed: [] as string[],
        duplicates: 0,
        get: async (key: string) => held.get(key) ?? null,
        set: async (key: string, value: string, ...options: unknown[]) => {
            recorder.commands.push(['SET', key, ...options.map(String)])
            held.set(key, value)
            return 'OK'
        },
        send: async (command: string) =>
            command === 'CLIENT' ? 'id=7 addr=127.0.0.1:6379 db=3 name=' : null,
        duplicate: async () => {
            recorder.duplicates += 1
            return recorder
        },
        subscribe: async (channel: string, listener: () => void) => {
            recorder.subscribed.push(channel)
            let set = listeners.get(channel)
            if (set === undefined) listeners.set(channel, (set = new Set()))
            set.add(listener)
            return set.size
        },
        unsubscribe: async (channel: string, listener: () => void) => {
            listeners.get(channel)?.delete(listener)
        },
        publish: (channel: string, _message: string) => {
            for (const listener of listeners.get(channel) ?? []) listener()
        },
    }
    return recorder
}
