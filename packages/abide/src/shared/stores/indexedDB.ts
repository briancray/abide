import type { Logged, LogStore } from '../ledger.ts'
import type { Store } from '../reactive/index.ts'
import { requested } from '../requested.ts'
import type { Schema } from '../Schema.ts'
import { KeptText, storeKey } from '../storedValue.ts'

const DATABASE_NAME = 'abide'

/** The open database, every table a store named so far in it. */
let database: Promise<IDBDatabase> | undefined

/** The document's one channel: a channel never hears its own posts, so this document's writes are not news to it. */
let channel: BroadcastChannel | undefined

/**
 * A `Store` kept in this browser's IndexedDB, in the `abide` database, under `key`.
 *
 * 8.35 — WHERE THERE IS NO INDEXEDDB, A SERVER, THE STORE IS INERT, as `store.web` is (8.23).
 * 8.36 — IndexedDB reports no change, so each write is posted on a `BroadcastChannel` and `watch`
 * hears another document's; a write made outside a `store.indexedDB` is not heard.
 *
 * 58.9 — AND AN APPEND FACE, for a `ledger`: a record per entry in `<table>_log` keyed by the store's
 * key and the entry's number, a record per key appended under in `<table>_logkey`, and one per named
 * cursor in `<table>_cursor` — each append posted, so a ledger in another document hears it (58.12).
 */
export function indexedDB<Stored>(
    key: string,
    options?: { table?: string; schema?: Schema<Stored> },
): Store<Stored> & LogStore {
    const table = options?.table ?? 'abide_store'
    const schema = options?.schema as Schema<unknown> | undefined
    const kept = new KeptText()
    const log = logFace(table, () => storeKey(key))
    return {
        // Synchronous where there is nothing to read: a promise, even of a miss, is a load (8.4),
        // and a server would render the value pending rather than its fallback.
        get: () => {
            if (typeof globalThis.indexedDB === 'undefined') return undefined
            return read(table, storeKey(key), kept, schema) as Promise<
                Stored | undefined
            >
        },
        set: (value, retention) => {
            if (typeof globalThis.indexedDB === 'undefined') return
            return written(
                table,
                storeKey(key),
                kept.write(value, retention.ttl),
            )
        },
        watch: (changed) => {
            if (typeof globalThis.indexedDB === 'undefined') return () => {}
            const listener = (event: MessageEvent): void => {
                const posted = event.data as { table: string; key: string }
                // 58.12 — one watch for the key: its value written, or its log appended to.
                if (
                    posted.key === storeKey(key) &&
                    (posted.table === table || posted.table === `${table}_log`)
                )
                    changed()
            }
            const listening = channelOf()
            listening.addEventListener('message', listener)
            return () => listening.removeEventListener('message', listener)
        },
        append: log.append,
        since: log.since,
        last: log.last,
        position: log.position,
        trim: log.trim,
    }
}

/** 58.9 — the append face over `<table>_log`, `<table>_logkey` and `<table>_cursor`, under `log()`. */
function logFace(table: string, log: () => string): LogStore {
    const entries = `${table}_log`
    const keys = `${table}_logkey`
    const cursors = `${table}_cursor`
    const tables = [entries, keys, cursors]
    const range = (from: number, to: number): IDBKeyRange =>
        IDBKeyRange.bound([log(), from], [log(), to])
    const lastIn = async (store: IDBObjectStore): Promise<number> => {
        const cursor = await requested(
            store.openKeyCursor(range(0, Number.MAX_SAFE_INTEGER), 'prev'),
        )
        return cursor === null
            ? 0
            : ((cursor.key as [string, number])[1] as number)
    }
    return {
        append: async (entry, key, at) => {
            if (typeof globalThis.indexedDB === 'undefined') return 0
            const db = await databaseWith(tables)
            const transaction = db.transaction([entries, keys], 'readwrite')
            const kept = transaction.objectStore(entries)
            const keyed = transaction.objectStore(keys)
            if (key !== undefined) {
                const seen = (await requested(keyed.get([log(), key]))) as
                    number | undefined
                if (seen !== undefined) return seen
            }
            const seq = (await lastIn(kept)) + 1
            kept.put({ seq, at, key, entry: JSON.stringify(entry) }, [
                log(),
                seq,
            ])
            if (key !== undefined) keyed.put(seq, [log(), key])
            await new Promise<void>((done, failed) => {
                transaction.oncomplete = () => done()
                transaction.onerror = () => failed(transaction.error)
                transaction.onabort = () => failed(transaction.error)
            })
            channelOf().postMessage({ table: entries, key: log() })
            return seq
        },
        since: async (seq) => {
            if (typeof globalThis.indexedDB === 'undefined') return []
            const db = await databaseWith(tables)
            const rows = (await requested(
                db
                    .transaction(entries, 'readonly')
                    .objectStore(entries)
                    .getAll(range(seq + 1, Number.MAX_SAFE_INTEGER), 256),
            )) as { seq: number; at: number; entry: string }[]
            const found: Logged<unknown>[] = []
            for (const row of rows)
                found.push({
                    seq: row.seq,
                    at: row.at,
                    entry: JSON.parse(row.entry),
                })
            return found
        },
        last: async () => {
            if (typeof globalThis.indexedDB === 'undefined') return 0
            const db = await databaseWith(tables)
            return lastIn(
                db.transaction(entries, 'readonly').objectStore(entries),
            )
        },
        position: async (cursor, seq) => {
            if (typeof globalThis.indexedDB === 'undefined') return seq ?? 0
            const db = await databaseWith(tables)
            const store = db
                .transaction(
                    cursors,
                    seq === undefined ? 'readonly' : 'readwrite',
                )
                .objectStore(cursors)
            if (seq !== undefined) {
                await requested(store.put(seq, [log(), cursor]))
                return seq
            }
            return (
                ((await requested(store.get([log(), cursor]))) as
                    number | undefined) ?? 0
            )
        },
        trim: async (through) => {
            if (typeof globalThis.indexedDB === 'undefined') return
            const db = await databaseWith(tables)
            const transaction = db.transaction([entries, keys], 'readwrite')
            const kept = transaction.objectStore(entries)
            const keyed = transaction.objectStore(keys)
            // 58.4 — the keys go with their entries.
            const going = (await requested(kept.getAll(range(0, through)))) as {
                key?: string
            }[]
            for (const record of going)
                if (record.key !== undefined) keyed.delete([log(), record.key])
            kept.delete(range(0, through))
            await new Promise<void>((done, failed) => {
                transaction.oncomplete = () => done()
                transaction.onerror = () => failed(transaction.error)
                transaction.onabort = () => failed(transaction.error)
            })
        },
    }
}

async function read(
    table: string,
    stored: string,
    kept: KeptText,
    schema: Schema<unknown> | undefined,
): Promise<unknown> {
    const db = await databaseWith(table)
    const text = (await requested(
        db.transaction(table, 'readonly').objectStore(table).get(stored),
    )) as string | undefined
    const where = `indexedDB[${JSON.stringify(table)}][${JSON.stringify(stored)}]`
    const value = kept.read(text, schema, where)
    // 8.26 — an entry past its deadline is gone, not merely skipped.
    if (value === undefined && text !== undefined)
        await requested(
            db
                .transaction(table, 'readwrite')
                .objectStore(table)
                .delete(stored),
        )
    return value
}

async function written(
    table: string,
    stored: string,
    text: string,
): Promise<void> {
    const db = await databaseWith(table)
    await requested(
        db.transaction(table, 'readwrite').objectStore(table).put(text, stored),
    )
    channelOf().postMessage({ table, key: stored })
}

function channelOf(): BroadcastChannel {
    channel ??= new BroadcastChannel(`${DATABASE_NAME}-store`)
    return channel
}

/**
 * The database, with `table` in it — or every one of the tables, where it is a list.
 *
 * A table is added by an upgrade, which needs a version past the open one — so the opens are
 * chained, one after another, rather than racing to the same version.
 */
function databaseWith(table: string | string[]): Promise<IDBDatabase> {
    const tables = typeof table === 'string' ? [table] : table
    const pending = (database ?? opened(undefined, tables)).then((db) => {
        let missing = false
        for (const name of tables)
            if (!db.objectStoreNames.contains(name)) missing = true
        if (!missing) return db
        const version = db.version + 1
        db.close()
        return opened(version, tables)
    })
    database = pending
    pending.catch(() => {
        if (database === pending) database = undefined
    })
    return pending
}

function opened(
    version: number | undefined,
    tables: string[],
): Promise<IDBDatabase> {
    const request =
        version === undefined
            ? globalThis.indexedDB.open(DATABASE_NAME)
            : globalThis.indexedDB.open(DATABASE_NAME, version)
    request.onupgradeneeded = () => {
        for (const table of tables)
            if (!request.result.objectStoreNames.contains(table))
                request.result.createObjectStore(table)
    }
    return requested(request).then((db) => {
        // Another document's upgrade waits on this connection: let it go, and reopen on next ask.
        db.onversionchange = () => {
            db.close()
            database = undefined
        }
        return db
    })
}
