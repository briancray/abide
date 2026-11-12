import type { Store } from '../reactive/index.ts'
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
 */
export function indexedDB<Stored>(
    key: string,
    options?: { table?: string; schema?: Schema<Stored> },
): Store<Stored> {
    const table = options?.table ?? 'abide_store'
    const schema = options?.schema as Schema<unknown> | undefined
    const kept = new KeptText()
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
                if (posted.table === table && posted.key === storeKey(key))
                    changed()
            }
            const listening = channelOf()
            listening.addEventListener('message', listener)
            return () => listening.removeEventListener('message', listener)
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

function requested<Result>(request: IDBRequest<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

/**
 * The database, with `table` in it.
 *
 * A table is added by an upgrade, which needs a version past the open one — so the opens are
 * chained, one after another, rather than racing to the same version.
 */
function databaseWith(table: string): Promise<IDBDatabase> {
    const pending = (database ?? opened(undefined, table)).then((db) => {
        if (db.objectStoreNames.contains(table)) return db
        const version = db.version + 1
        db.close()
        return opened(version, table)
    })
    database = pending
    pending.catch(() => {
        if (database === pending) database = undefined
    })
    return pending
}

function opened(
    version: number | undefined,
    table: string,
): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request =
            version === undefined
                ? globalThis.indexedDB.open(DATABASE_NAME)
                : globalThis.indexedDB.open(DATABASE_NAME, version)
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(table))
                request.result.createObjectStore(table)
        }
        request.onsuccess = () => {
            const db = request.result
            // Another document's upgrade waits on this connection: let it go, and reopen on next ask.
            db.onversionchange = () => {
                db.close()
                database = undefined
            }
            resolve(db)
        }
        request.onerror = () => reject(request.error)
    })
}
