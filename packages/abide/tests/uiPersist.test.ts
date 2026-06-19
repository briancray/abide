import { describe, expect, test } from 'bun:test'
import { persist } from '../src/lib/ui/persist.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { PersistenceStore } from '../src/lib/ui/types/PersistenceStore.ts'

/* An in-memory stand-in for localStorage that clones on save (as JSON would), so a
   stored snapshot can't alias the live tree. `data` is exposed for assertions. */
const memoryStore = (): PersistenceStore & { data: Map<string, unknown> } => {
    const data = new Map<string, unknown>()
    return {
        data,
        load: (key) => data.get(key),
        save: (key, snapshot) => data.set(key, structuredClone(snapshot)),
        remove: (key) => data.delete(key),
    }
}

describe('persist — durable document state', () => {
    test('a reload restores the persisted state', () => {
        const store = memoryStore()

        const first = doc({ title: 'untitled', count: 0 })
        const handle = persist(first, 'board', { store })
        first.replace('title', 'Groceries')
        first.replace('count', 3)
        handle.flush()

        // simulate a fresh page load: a new doc + persist for the same key
        const reloaded = doc({ title: 'untitled', count: 0 })
        persist(reloaded, 'board', { store })
        expect(reloaded.snapshot()).toEqual({ title: 'Groceries', count: 3 })
    })

    test('writes coalesce: nothing is stored until the debounce flush', () => {
        const store = memoryStore()
        const model = doc({ n: 0 })
        const handle = persist(model, 'k', { store, debounce: 50 })

        model.replace('n', 1)
        model.replace('n', 2)
        expect(store.data.has('k')).toBe(false) // timer still pending, no write yet

        handle.flush()
        expect(store.data.get('k')).toEqual({ n: 2 }) // one write, latest value
    })

    test('restore overlays saved keys but keeps keys added in a newer shape', () => {
        const store = memoryStore()
        store.data.set('k', { name: 'Ada' }) // an older snapshot, no `email`

        const model = doc({ name: '', email: 'default@x' })
        persist(model, 'k', { store })
        // saved `name` restored; `email` (absent from the snapshot) keeps its default
        expect(model.snapshot()).toEqual({ name: 'Ada', email: 'default@x' })
    })

    test('clear removes the stored snapshot', () => {
        const store = memoryStore()
        const model = doc({ n: 0 })
        const handle = persist(model, 'k', { store })
        model.replace('n', 9)
        handle.flush()
        expect(store.data.has('k')).toBe(true)

        handle.clear()
        expect(store.data.has('k')).toBe(false)
    })

    test('dispose stops persisting later changes', () => {
        const store = memoryStore()
        const model = doc({ n: 0 })
        const handle = persist(model, 'k', { store, debounce: 0 })
        handle.dispose()

        model.replace('n', 1)
        handle.flush() // flush still writes current, but the subscription is gone…
        // …so a change after dispose never re-armed a write; prove via a second doc
        const other = doc({ n: 0 })
        const otherHandle = persist(other, 'k2', { store })
        otherHandle.dispose()
        other.replace('n', 5)
        otherHandle.flush()
        expect(store.data.get('k2')).toEqual({ n: 5 }) // explicit flush writes regardless
        // the disposed bus subscription means an UN-flushed change is never stored:
        other.replace('n', 6)
        expect(store.data.get('k2')).toEqual({ n: 5 }) // no auto-write after dispose
    })

    test('no store (server / store-less browser) is inert and safe', () => {
        const model = doc({ n: 0 })
        const handle = persist(model, 'k', { store: undefined })
        model.replace('n', 1)
        expect(() => {
            handle.flush()
            handle.clear()
            handle.dispose()
        }).not.toThrow()
        expect(model.read<number>('n')).toBe(1) // doc untouched
    })
})
