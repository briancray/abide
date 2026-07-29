// A MEMO'S OWN SLOT INDEX over a shared cache — and the confirm-by-identity read that keeps it honest.
//
// The backing store holds EVERY memo's slots for the whole request, so answering "which slots are
// mine?" by scanning it made each verb O(all slots in the context) — and `snapshot()` runs once per
// read route in the SSR seed collector, which turns that into O(routes x slots) per page render. The
// index is what makes it O(own slots).
//
// THE INDEX IS A CACHE, NOT THE TRUTH, and that is the whole reason this is its own module. Eviction
// happens in the STORE (`sharedCacheEvictIfNeeded` deletes directly, LRU), so an indexed slot can
// already be gone; and a later `ensureSlot` can replace a slot under the same key. So every read
// confirms each entry against the store BY IDENTITY — not by presence, which would keep a superseded
// slot — and drops a stale one in passing. That self-heal is the correctness bridge between two
// structures that evolve independently, and it had no direct test: `memo.test.ts` reaches it only
// through reads, and `sharedCache.test.ts` tests the LRU from the other side without knowing the index
// exists, so the exact interleaving it exists for was unreachable from either.

import { canonicalKey } from './codec.ts'

// A selector and a slot's args are matched structurally, so only a plain object counts as a partial
// selector — a class instance or an array is compared whole, by canonical key.
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

// The minimum a slot must expose to be indexed: the store key it lives under, and the args a selector
// matches against.
export interface IndexedSlot {
    key: string
    args: unknown
}

// A selector's canonical keys, computed ONCE per verb call. `selectSlots` scans every slot of the memo,
// so deriving the selector side inside the per-slot match recomputed identical `canonicalKey(selector…)`
// values (each with its own alloc) for every slot — O(slots × selectorKeys) → O(slots + selectorKeys).
type CompiledSelector =
    | { kind: 'object'; keys: string[]; values: string[] }
    | { kind: 'exact'; canonical: string }

function compileSelector(selector: unknown): CompiledSelector {
    if (isPlainObject(selector)) {
        const keys = Object.keys(selector)
        const values: string[] = []
        for (let i = 0; i < keys.length; i++) values.push(canonicalKey(selector[keys[i] as string]))
        return { kind: 'object', keys, values }
    }
    return { kind: 'exact', canonical: canonicalKey(selector) }
}

// Superset match (§8.2): a selector object matches a slot whose args include every selector
// key with a canonically-equal value. Non-object selectors fall back to exact key equality.
function matchesSelector(slotArgs: unknown, compiled: CompiledSelector): boolean {
    if (compiled.kind === 'object') {
        if (!isPlainObject(slotArgs)) return false
        const keys = compiled.keys
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i] as string
            if (!(key in slotArgs)) return false
            if (canonicalKey(slotArgs[key]) !== compiled.values[i]) return false
        }
        return true
    }
    return canonicalKey(slotArgs) === compiled.canonical
}

export interface SlotIndex<S extends IndexedSlot> {
    // Record a freshly created slot. The caller has already put it in the store.
    add(cache: Map<string, unknown>, slot: S): void
    // Forget a slot the caller is disposing.
    forget(cache: Map<string, unknown>, key: string): void
    // Every live slot of this memo in `cache`, optionally filtered. `selector === undefined` means ALL
    // (a zero-arg memo's slot is keyed on `undefined` args, but it is reached with no selector at all).
    select(cache: Map<string, unknown>, selector: unknown, filtered: boolean): S[]
}

export function createSlotIndex<S extends IndexedSlot>(): SlotIndex<S> {
    const ownSlots = new WeakMap<Map<string, unknown>, Map<string, S>>()

    function ownSlotsIn(cache: Map<string, unknown>): Map<string, S> {
        let own = ownSlots.get(cache)
        if (own === undefined) {
            own = new Map<string, S>()
            ownSlots.set(cache, own)
        }
        return own
    }

    return {
        add(cache, slot) {
            ownSlotsIn(cache).set(slot.key, slot)
        },
        forget(cache, key) {
            ownSlotsIn(cache).delete(key)
        },
        select(cache, selector, filtered) {
            const own = ownSlotsIn(cache)
            const result: S[] = []
            // Compile the selector's canonical keys once, not per slot scanned.
            const compiled = filtered ? compileSelector(selector) : undefined
            for (const [slotKey, slot] of own) {
                if (cache.get(slotKey) !== slot) {
                    own.delete(slotKey) // evicted (or superseded) behind our back — self-heal
                    continue
                }
                if (compiled === undefined || matchesSelector(slot.args, compiled))
                    result.push(slot)
            }
            return result
        },
    }
}
