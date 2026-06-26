import type { PersistenceStore } from '../../src/lib/ui/types/PersistenceStore.ts'

/* A Map-backed PersistenceStore for tests: synchronous load/save/remove (the real
   contract) plus a `has` probe so a test can assert what was persisted. */
export function memoryStore(): PersistenceStore & { has: (key: string) => boolean } {
    const map = new Map<string, unknown>()
    return {
        load: (key) => map.get(key),
        save: (key, snapshot) => void map.set(key, snapshot),
        remove: (key) => void map.delete(key),
        has: (key) => map.has(key),
    }
}
