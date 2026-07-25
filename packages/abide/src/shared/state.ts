// Public reactive state primitive for `.abide` components (M3a).
//
// In a `.abide` `<script>` an author writes `let count = state(0)` and then reads/writes `count` as a
// plain identifier. The AOT emitter's scope analysis (internal/analyzeScope.ts) recognises the cell
// this declaration returns and rewrites every reference — `count` → `count()`, `count = x` →
// `count.set(x)` — so the bare name reads and writes the underlying atom.
//
// A `State` IS the reactive atom (`internal/reactive.ts`) plus a kind brand — not a second kind of
// cell wrapping a first. The brand is a global-registry symbol so the analysis can detect a cell
// (syntactically, at the declaration) without importing anything from here (keeps the one-export-per-
// file rule intact). The cell is CALLABLE — `count()` reads and `count.set(x)` writes, exactly the
// atom's own call/`set`/`peek`.

import { type State as ReactiveState, state as reactiveState } from './internal/reactive.ts'

// Global-registry brand so `analyzeScope.ts` recognises a cell by identity without a shared import.
const STATE_CELL = Symbol.for('abide.ui.stateCell')

// The reactive kinds a cell can be. Both are OWNED and writable — derivation is `memo`'s job (ADR 0024).
type StateKind = 'state' | 'shared'

// Client (browser DOM) vs SSR (bun, no DOM). `document` is the reliable discriminator: present in a
// real browser AND under the test DOM, absent on the abide server — where a process-global shared
// registry would leak one request's state into another's, so `.shared` must stay per-render there.
const isClient = typeof document !== 'undefined'

// A callable branded reactive cell — the atom's shape (`()` tracks, `set()` publishes, `peek()` reads
// untracked) plus the kind brand.
export interface State<T> extends ReactiveState<T> {
    [STATE_CELL]: StateKind
}

// The public `state` surface: callable to make a writable cell, plus the `.shared` factory. `state` keeps
// only what it OWNS (ADR 0024) — `.computed` and `.linked` were never owned state, they were fed, and both
// are one mechanism: a `memo`. `memo(() => …)` is the old `computed`; `memo(() => …).state()` is the old
// `linked`, where a local write holds until the next re-fill.
export interface StateFactory {
    <T>(initial: T, transform?: (value: T) => T): State<T>
    shared<T>(key: string, initial: T): State<T>
}

function makeState<T>(initial: T, transform?: (value: T) => T): State<T> {
    const backing = reactiveState<T>(transform ? transform(initial) : initial)
    const cell = (() => backing()) as State<T>
    cell.set = (value: T) => backing.set(transform ? transform(value) : value)
    cell.peek = () => backing.peek()
    cell[STATE_CELL] = 'state'
    return cell
}

// A writable cell shared by KEY across every component instance on the client — same key, same backing
// atom — and synced across same-origin browser TABS over a Web-standard `BroadcastChannel`. A write
// updates the local atom and posts `{ key, value }` (JSON-serializable values only) to the other
// tabs, whose matching cells apply it WITHOUT re-broadcasting. On the SERVER there is no cross-instance
// sharing (a process-global store would leak one request's state to another), so it degrades to a plain
// per-render cell seeded with `initial` — the same value the client's first instance starts from, so
// hydration stays consistent.
interface SharedSlot {
    backing: ReactiveState<unknown>
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

function makeShared<T>(key: string, initial: T): State<T> {
    if (!isClient) {
        // Server: isolated per-render cell (no cross-request registry).
        const backing = reactiveState<T>(initial)
        const cell = (() => backing()) as State<T>
        cell.set = (value: T) => backing.set(value)
        cell.peek = () => backing.peek()
        cell[STATE_CELL] = 'shared'
        return cell
    }
    let slot = SHARED_SLOTS.get(key)
    if (slot === undefined) {
        slot = { backing: reactiveState<unknown>(initial) }
        SHARED_SLOTS.set(key, slot)
    }
    ensureChannel()
    const backing = slot.backing
    const cell = (() => backing() as T) as State<T>
    cell.set = (value: T) => {
        backing.set(value)
        const channel = ensureChannel()
        if (channel !== undefined) {
            try {
                channel.postMessage({ key, value })
            } catch {
                // Non-serializable value: keep it local rather than throwing on the write path.
            }
        }
    }
    cell.peek = () => backing.peek() as T
    cell[STATE_CELL] = 'shared'
    return cell
}

export const state: StateFactory = Object.assign(makeState as StateFactory, {
    shared: makeShared,
})
