// Public reactive state primitive for `.abide` components (M3a).
//
// In a `.abide` `<script>` an author writes `let count = state(0)` and then reads/writes `count` as a
// plain identifier. The AOT emitter's scope analysis (internal/analyzeScope.ts) recognises the cell
// this declaration returns and rewrites every reference — `count` → `count.read()`, `count = x` →
// `count.write(x)` — so the bare name reads and writes the underlying signal.
//
// A `StateCell` is a small branded record over the M1 signal substrate. The brand is a global-registry
// symbol so the analysis can detect a cell (syntactically, at the declaration) without importing
// anything from here (keeps the one-export-per-file rule intact). Cells are NOT callable — the
// `.read()/.write()` rewrite is what makes `count` behave like a plain value.

import { computed, effect, type Signal, signal } from '../shared/internal/reactive.ts'

// Global-registry brand so `analyzeScope.ts` recognises a cell by identity without a shared import.
const STATE_CELL = Symbol.for('abide.ui.stateCell')

// The reactive kinds a cell can be. `computed` cells are read-only (no setter installed).
type StateKind = 'state' | 'computed' | 'linked' | 'shared'

// Client (browser DOM) vs SSR (bun, no DOM). `document` is the reliable discriminator: present in a
// real browser AND under the test DOM, absent on the abide server — where a process-global shared
// registry would leak one request's state into another's, so `.shared` must stay per-render there.
const isClient = typeof document !== 'undefined'

// A branded reactive cell. `read()` tracks; `write()` publishes; `peek()` reads untracked. `computed`
// cells throw on `write`.
export interface StateCell<T> {
    [STATE_CELL]: StateKind
    read(): T
    write(value: T): void
    peek(): T
}

// The public `state` surface: callable to make a writable cell, with `.computed` / `.linked` /
// `.shared` factories.
export interface State {
    <T>(initial: T, transform?: (value: T) => T): StateCell<T>
    computed<T>(fn: () => T): StateCell<T>
    linked<S, T>(source: () => S, transform?: (value: S) => T): StateCell<T>
    shared<T>(key: string, initial: T): StateCell<T>
}

function makeState<T>(initial: T, transform?: (value: T) => T): StateCell<T> {
    const backing = signal<T>(transform ? transform(initial) : initial)
    return {
        [STATE_CELL]: 'state',
        read: () => backing(),
        write: (value: T) => backing.set(transform ? transform(value) : value),
        peek: () => backing.peek(),
    }
}

function makeComputed<T>(fn: () => T): StateCell<T> {
    const derived = computed<T>(fn)
    return {
        [STATE_CELL]: 'computed',
        read: () => derived(),
        write: () => {
            throw new TypeError('state.computed(...) is read-only and cannot be assigned')
        },
        peek: () => derived.peek(),
    }
}

// A writable cell whose value is reseeded whenever `source` changes. Local writes hold until the next
// reseed. The reseed effect lives for the component's lifetime (owned by the instance scope).
function makeLinked<S, T>(source: () => S, transform?: (value: S) => T): StateCell<T> {
    const backing = signal<T>(undefined as unknown as T)
    let seeded = false
    effect(() => {
        const next = source()
        const value = (transform ? transform(next) : (next as unknown as T)) as T
        backing.set(value)
        seeded = true
    })
    // Guard: if an effect flush has not yet run (server single-pass), the effect above ran synchronously
    // on creation, so `seeded` is already true here.
    void seeded
    return {
        [STATE_CELL]: 'linked',
        read: () => backing(),
        write: (value: T) => backing.set(value),
        peek: () => backing.peek(),
    }
}

// A writable cell shared by KEY across every component instance on the client — same key, same backing
// signal — and synced across same-origin browser TABS over a Web-standard `BroadcastChannel`. A write
// updates the local signal and posts `{ key, value }` (JSON-serializable values only) to the other
// tabs, whose matching cells apply it WITHOUT re-broadcasting. On the SERVER there is no cross-instance
// sharing (a process-global store would leak one request's state to another), so it degrades to a plain
// per-render cell seeded with `initial` — the same value the client's first instance starts from, so
// hydration stays consistent.
interface SharedSlot {
    backing: Signal<unknown>
}
const SHARED_SLOTS = new Map<string, SharedSlot>()
let sharedChannel: BroadcastChannel | undefined
let channelResolved = false

function ensureChannel(): BroadcastChannel | undefined {
    if (!isClient) return undefined
    if (!channelResolved) {
        channelResolved = true
        try {
            const channel = new BroadcastChannel('abide:state:shared')
            channel.onmessage = (event: MessageEvent) => {
                const data = event.data as { key?: unknown; value?: unknown } | null
                if (data === null || typeof data.key !== 'string') return
                const slot = SHARED_SLOTS.get(data.key)
                if (slot !== undefined) slot.backing.set(data.value) // apply remote write WITHOUT re-broadcast
            }
            sharedChannel = channel
        } catch {
            sharedChannel = undefined
        }
    }
    return sharedChannel
}

function makeShared<T>(key: string, initial: T): StateCell<T> {
    if (!isClient) {
        // Server: isolated per-render cell (no cross-request registry).
        const backing = signal<T>(initial)
        return {
            [STATE_CELL]: 'shared',
            read: () => backing(),
            write: (value: T) => backing.set(value),
            peek: () => backing.peek(),
        }
    }
    let slot = SHARED_SLOTS.get(key)
    if (slot === undefined) {
        slot = { backing: signal<unknown>(initial) }
        SHARED_SLOTS.set(key, slot)
    }
    ensureChannel()
    const backing = slot.backing
    return {
        [STATE_CELL]: 'shared',
        read: () => backing() as T,
        write: (value: T) => {
            backing.set(value)
            const channel = ensureChannel()
            if (channel !== undefined) {
                try {
                    channel.postMessage({ key, value })
                } catch {
                    // Non-serializable value: keep it local rather than throwing on the write path.
                }
            }
        },
        peek: () => backing.peek() as T,
    }
}

export const state: State = Object.assign(makeState as State, {
    computed: makeComputed,
    linked: makeLinked,
    shared: makeShared,
})
