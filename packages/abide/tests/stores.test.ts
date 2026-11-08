// THE SHIPPED STORES — `webStore` and `sqliteStore` (RULEBOOK 8.22 through 8.28). Each is a `Store`
// an app would otherwise write by hand, so the claims are about what lands in the value: a restore,
// a miss, and a re-read when another document writes.

import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'

import { sqliteStore } from '#server/sqliteStore.ts'
import { flushSync, reactive, webStore } from '#shared'

afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
})

const isNumber = (value: unknown): number => {
    if (typeof value !== 'number') throw new Error('not a number')
    return value
}

// 8.22 AND 8.28: A WRITE IS KEPT, AS JSON, AND THE NEXT VALUE BUILT OVER THE KEY OPENS ON IT.
test('webStore keeps a value in localStorage and a new value restores it — 8.22, 8.28', () => {
    const first = reactive(1, { store: webStore<number>('count') })
    first.set(7)
    expect(JSON.parse(localStorage.getItem('count') ?? 'null')).toEqual({
        value: 7,
        expires: null,
    })
    const second = reactive(1, { store: webStore<number>('count') })
    expect(`restored: ${second()}`).toBe('restored: 7')
    expect(`session: ${sessionStorage.getItem('count')}`).toBe('session: null')
})

test('webStore keeps a value in sessionStorage where the area is session — 8.22', () => {
    reactive(1, { store: webStore<number>('tab', { area: 'session' }) }).set(3)
    expect(`local: ${localStorage.getItem('tab')}`).toBe('local: null')
    const again = reactive(1, {
        store: webStore<number>('tab', { area: 'session' }),
    })
    expect(`restored: ${again()}`).toBe('restored: 3')
})

// 8.23: NO WEB STORAGE, AS ON A SERVER, IS A STORE THAT IS NEVER THERE — the initial value lands
// and nothing throws.
test('webStore is inert where there is no Web Storage — 8.23', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'localStorage',
    ) as PropertyDescriptor
    Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
    })
    try {
        const store = webStore<number>('count')
        expect(`get: ${store.get()}`).toBe('get: undefined')
        store.set(4, { ttl: Number.POSITIVE_INFINITY })
        const value = reactive(2, { store })
        expect(`value: ${value()}`).toBe('value: 2')
    } finally {
        Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
})

// 8.24: ANOTHER DOCUMENT'S WRITE IS READ BACK. The `storage` event is the browser's report of one,
// and the value re-reads `get` (8.20) — an event for another key, or another area, is not news.
//
// THE REVERT: have `watch` answer a no-op stop without listening, and `after: 1` where `after: 9`.
test('webStore follows another document’s write through the storage event — 8.24', () => {
    const value = reactive(1, { store: webStore<number>('shared') })
    expect(`before: ${value()}`).toBe('before: 1')
    localStorage.setItem('shared', JSON.stringify({ value: 5, expires: null }))
    dispatchEvent(
        new StorageEvent('storage', {
            key: 'other',
            storageArea: localStorage,
        }),
    )
    dispatchEvent(
        new StorageEvent('storage', {
            key: 'shared',
            storageArea: sessionStorage,
        }),
    )
    flushSync()
    expect(`unrelated: ${value()}`).toBe('unrelated: 1')
    localStorage.setItem('shared', JSON.stringify({ value: 9, expires: null }))
    dispatchEvent(
        new StorageEvent('storage', {
            key: 'shared',
            storageArea: localStorage,
        }),
    )
    flushSync()
    expect(`after: ${value()}`).toBe('after: 9')
})

// 8.26: WHAT A VALUE'S `ttl` SAYS IS KEPT BESIDE IT. A restore after the deadline is a miss, and the
// entry is removed rather than read past on every visit.
//
// THE REVERT: drop the `expires` test from `storedValue`, and `after the deadline: 3, 3` where
// `undefined, undefined` is due.
test('webStore and sqliteStore answer a miss past the ttl a value was written with — 8.26', async () => {
    const web = webStore<number>('brief')
    const sqlite = sqliteStore<number>(new Database(':memory:'), 'brief')
    web.set(3, { ttl: 20 })
    sqlite.set(3, { ttl: 20 })
    expect(`before: ${web.get()}, ${sqlite.get()}`).toBe('before: 3, 3')
    await Bun.sleep(40)
    expect(`after the deadline: ${web.get()}, ${sqlite.get()}`).toBe(
        'after the deadline: undefined, undefined',
    )
    expect(`removed: ${localStorage.getItem('brief')}`).toBe('removed: null')
})

// 8.27: A RESTORE SKIPS THE VALUE'S `schema` (8.5), SO A SHIPPED STORE RUNS ITS OWN. What it refuses
// is a miss, and the value lands its initial value rather than an entry an older build wrote.
//
// THE REVERT: return `kept.value` from `storedValue` without running the schema, and
// `value: not a number` where `value: 1` is due.
test('a shipped store’s schema turns a value it refuses into a miss — 8.27', () => {
    localStorage.setItem(
        'count',
        JSON.stringify({ value: 'not a number', expires: null }),
    )
    const value = reactive(1, {
        store: webStore('count', { schema: isNumber }),
    })
    expect(`value: ${value()}`).toBe('value: 1')

    const db = new Database(':memory:')
    sqliteStore<string>(db, 'count').set('not a number', {
        ttl: Number.POSITIVE_INFINITY,
    })
    const server = reactive(1, {
        store: sqliteStore(db, 'count', { schema: isNumber }),
    })
    expect(`server: ${server()}`).toBe('server: 1')
})

// 8.25: A ROW PER KEY IN A TABLE THE STORE MAKES, one connection per path however many stores name it.
test('sqliteStore keeps a value in a row of its table, made where missing — 8.25, 8.28', () => {
    const path = `${Bun.env.TMPDIR ?? '/tmp'}/abide-sqlite-store-${process.pid}.db`
    try {
        const first = reactive(() => ({ list: [1, 2] }), {
            store: sqliteStore<{ list: number[] }>(path, 'doc', {
                table: 'kept',
            }),
        })
        expect(first()).toEqual({ list: [1, 2] })
        const db = new Database(path)
        const row = db
            .query('SELECT value, expires FROM kept WHERE key = ?')
            .get('doc')
        expect(row).toEqual({ value: '{"list":[1,2]}', expires: null })
        db.close()
        let runs = 0
        const second = reactive(
            () => {
                runs += 1
                return { list: [] as number[] }
            },
            {
                store: sqliteStore<{ list: number[] }>(path, 'doc', {
                    table: 'kept',
                }),
            },
        )
        expect(second()).toEqual({ list: [1, 2] })
        expect(`runs: ${runs}`).toBe('runs: 0')
        expect(() =>
            sqliteStore(path, 'doc', { table: 'kept; DROP TABLE kept' }),
        ).toThrow('is not an SQL identifier')
    } finally {
        for (const suffix of ['', '-wal', '-shm'])
            Bun.file(`${path}${suffix}`)
                .delete()
                .catch(() => {})
    }
})
