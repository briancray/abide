import type { Store } from './reactive/index.ts'
import type { Schema } from './Schema.ts'
import { KeptText, storeKey } from './storedValue.ts'

/**
 * A `Store` kept in this browser's `localStorage`, or its `sessionStorage`, under `key`.
 *
 * 8.23 — WHERE THERE IS NO WEB STORAGE, A SERVER, THE STORE IS INERT: every `get` a miss and every
 * `set` nothing, so the value a server renders is the one it would render with no store (8.3).
 * The storage is looked up on each call rather than held, since a browser that refuses storage
 * throws on the lookup — and a throw there is 8.15's miss and 8.12's warning, not a broken module.
 */
export function webStore<Stored>(
    key: string,
    options?: { area?: 'local' | 'session'; schema?: Schema<Stored> },
): Store<Stored> {
    const name = options?.area === 'session' ? 'sessionStorage' : 'localStorage'
    const schema = options?.schema as Schema<unknown> | undefined
    const kept = new KeptText()
    const area = (): Storage | undefined =>
        (globalThis as unknown as Record<string, Storage | undefined>)[name]
    return {
        get: () => {
            const storage = area()
            if (storage === undefined) return undefined
            const stored = storeKey(key)
            const text = storage.getItem(stored)
            const where = `${name}[${JSON.stringify(stored)}]`
            const value = kept.read(text, schema, where)
            // 8.26 — an entry past its deadline is gone, not merely skipped.
            if (value === undefined && text !== null) storage.removeItem(stored)
            return value as Stored | undefined
        },
        set: (value, retention) => {
            area()?.setItem(storeKey(key), kept.write(value, retention.ttl))
        },
        // 8.24 — another document's write arrives as a `storage` event; this document's own never does.
        watch: (changed) => {
            if (typeof globalThis.addEventListener !== 'function')
                return () => {}
            const listener = (event: StorageEvent): void => {
                if (
                    event.storageArea === area() &&
                    (event.key === storeKey(key) || event.key === null)
                )
                    changed()
            }
            globalThis.addEventListener('storage', listener)
            return () => globalThis.removeEventListener('storage', listener)
        },
    }
}
