// THE INDEX THAT CAN LIE — and the confirm-by-identity read that keeps it honest.
//
// A memo's slot index is a cache over the shared store, kept because scanning the store made every
// verb O(all slots in the context). The store is mutated behind the index's back in two ways: LRU
// eviction deletes directly, and a later `ensureSlot` can replace a slot under the same key. So every
// read confirms each entry against the store BY IDENTITY and drops a stale one in passing.
//
// That self-heal is the correctness bridge between two structures that evolve independently, and it
// had no direct test: `memo.test.ts` reaches it only through reads, `sharedCache.test.ts` tests the LRU
// from the other side without knowing the index exists, and the exact interleaving it exists for —
// "a slot some later `ensureSlot` replaced under the same key" — was unreachable from either.

import { describe, expect, test } from 'bun:test'
import { createSlotIndex, type IndexedSlot } from './slotIndex.ts'

interface TestSlot extends IndexedSlot {
    args: unknown
    tag: string
}

const slot = (key: string, args: unknown, tag = key): TestSlot => ({ key, args, tag })

// A store + index with the slots already added, as `ensureSlot` would leave them.
function withSlots(...slots: TestSlot[]) {
    const cache = new Map<string, unknown>()
    const index = createSlotIndex<TestSlot>()
    for (const s of slots) {
        cache.set(s.key, s)
        index.add(cache, s)
    }
    return { cache, index }
}

const all = (index: ReturnType<typeof createSlotIndex<TestSlot>>, cache: Map<string, unknown>) =>
    index.select(cache, undefined, false)

describe('the index answers only its OWN slots', () => {
    test('a foreign slot in the same store is not returned', () => {
        // The store holds every memo's slots for the whole request. Scanning it is what the index
        // exists to avoid, and returning a foreign slot would let one memo's verb hit another's.
        const { cache, index } = withSlots(slot('mine:1', { id: 1 }))
        cache.set('theirs:1', slot('theirs:1', { id: 1 }))
        expect(all(index, cache).map((s) => s.tag)).toEqual(['mine:1'])
    })

    test('an empty index answers nothing', () => {
        const cache = new Map<string, unknown>()
        expect(all(createSlotIndex<TestSlot>(), cache)).toEqual([])
    })

    test('the index is PER STORE — a different cache shares no entries', () => {
        // Request-scoped stores come and go; an index keyed globally would hand one request's slots to
        // the next. (It is a WeakMap on the cache, so the entries go with it.)
        const { index, cache } = withSlots(slot('a', 1))
        expect(all(index, new Map())).toEqual([])
        expect(all(index, cache)).toHaveLength(1)
    })
})

describe('the self-heal', () => {
    test('a slot EVICTED from the store is dropped rather than returned', () => {
        const { cache, index } = withSlots(slot('a', 1), slot('b', 2))
        cache.delete('a') // LRU eviction, straight into the store
        expect(all(index, cache).map((s) => s.tag)).toEqual(['b'])
    })

    test('a slot REPLACED under the same key is dropped — presence is not enough', () => {
        // The check is `cache.get(key) !== slot`, not `cache.has(key)`. A presence check would keep the
        // superseded slot: the verb would then refresh, invalidate or publish into an object nothing
        // reads, and the live slot would never see it.
        const { cache, index } = withSlots(slot('a', 1, 'first'))
        const replacement = slot('a', 1, 'second')
        cache.set('a', replacement) // a later ensureSlot, same key, new object
        expect(all(index, cache)).toEqual([])

        // …and once the replacement is indexed, it is the one answered.
        index.add(cache, replacement)
        expect(all(index, cache).map((s) => s.tag)).toEqual(['second'])
    })

    test('the drop is PERMANENT — the stale entry is removed, not skipped each time', () => {
        // Skipping without deleting would leave the scan O(every slot this memo ever had) for the life
        // of the store, which is the cost the index exists to avoid in the first place.
        const { cache, index } = withSlots(slot('a', 1))
        cache.delete('a')
        expect(all(index, cache)).toEqual([])
        // Re-adding to the STORE alone must not resurrect the forgotten entry.
        cache.set('a', slot('a', 1))
        expect(all(index, cache)).toEqual([])
    })

    test('`forget` removes an entry the caller is disposing', () => {
        const { cache, index } = withSlots(slot('a', 1), slot('b', 2))
        index.forget(cache, 'a')
        expect(all(index, cache).map((s) => s.tag)).toEqual(['b'])
    })
})

describe('selector matching', () => {
    const populated = () =>
        withSlots(
            slot('u1', { id: 1, tab: 'a' }),
            slot('u2', { id: 2, tab: 'a' }),
            slot('u3', { id: 1, tab: 'b' }),
        )

    test('no selector means EVERY slot', () => {
        const { cache, index } = populated()
        expect(all(index, cache)).toHaveLength(3)
    })

    test('a partial selector matches every SUPERSET slot', () => {
        const { cache, index } = populated()
        expect(index.select(cache, { id: 1 }, true).map((s) => s.tag)).toEqual(['u1', 'u3'])
        expect(index.select(cache, { tab: 'a' }, true).map((s) => s.tag)).toEqual(['u1', 'u2'])
    })

    test('a full selector matches the one slot', () => {
        const { cache, index } = populated()
        expect(index.select(cache, { id: 1, tab: 'b' }, true).map((s) => s.tag)).toEqual(['u3'])
    })

    test('a selector key the slot lacks matches nothing', () => {
        const { cache, index } = populated()
        expect(index.select(cache, { missing: 1 }, true)).toEqual([])
    })

    test('values are compared CANONICALLY, so key order does not matter', () => {
        const { cache, index } = withSlots(slot('k', { a: 1, b: 2 }))
        expect(index.select(cache, { b: 2, a: 1 }, true)).toHaveLength(1)
    })

    test('a non-object selector is matched EXACTLY, not as a superset', () => {
        const { cache, index } = withSlots(slot('n1', 1), slot('n2', 2))
        expect(index.select(cache, 1, true).map((s) => s.tag)).toEqual(['n1'])
    })

    test('an object selector does not match a non-object slot arg', () => {
        const { cache, index } = withSlots(slot('n1', 1))
        expect(index.select(cache, { id: 1 }, true)).toEqual([])
    })

    test('an ARRAY arg is compared whole, not treated as a partial selector', () => {
        // Only a plain object is a partial selector; an array or class instance is one value.
        const { cache, index } = withSlots(slot('a', [1, 2]), slot('b', [1, 3]))
        expect(index.select(cache, [1, 2], true).map((s) => s.tag)).toEqual(['a'])
    })

    test('a filtered select ALSO self-heals', () => {
        // The eviction check runs before the match, so a stale entry cannot survive by failing to match.
        const { cache, index } = populated()
        cache.delete('u1')
        expect(index.select(cache, { id: 1 }, true).map((s) => s.tag)).toEqual(['u3'])
        // Confirmed gone, not merely unmatched this time.
        expect(all(index, cache)).toHaveLength(2)
    })
})
