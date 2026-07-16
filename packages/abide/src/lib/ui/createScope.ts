import { decodeRefJson } from '../shared/decodeRefJson.ts'
import { docSnapshotsSlot } from '../shared/docSnapshotsSlot.ts'
import { computed } from './computed.ts'
import { effect } from './effect.ts'
import { linked } from './linked.ts'
import { CURRENT_PATH } from './runtime/CURRENT_PATH.ts'
import { consumeSeed } from './runtime/consumeSeed.ts'
import { createDoc } from './runtime/createDoc.ts'
import { DOC_SEED } from './runtime/DOC_SEED.ts'
import type { Cell } from './runtime/types/Cell.ts'
import type { Doc } from './runtime/types/Doc.ts'
import { state } from './state.ts'
import { trackedComputed } from './trackedComputed.ts'
import type { Scope } from './types/Scope.ts'

/* The counter fallback for a DETACHED scope — one created outside any render (a bare
   `scope()` on first use), where the ambient render-path is empty.
   A rendered scope instead takes the serialization-stable render-path id (`CURRENT_PATH`,
   route + tree position), so an async cell's warm-seed key (`${scope.id}:${index}`) is
   stable across the SSR→client handoff; only the counter path remains merely run-unique. */
let nextId = 0

/*
Builds a lexical scope. Its data is a document — created eagerly from `initial`,
or (when `awaiting`) ADOPTED from the first `doc()` a component body creates under
it, so a scope can wrap the component's own model without changing the data
lowering. Data methods mirror `Doc` and delegate to that document; `child` nests;
`dispose` tears the subtree down children-first.
*/
export function createScope(
    initial: unknown = {},
    parent: Scope | undefined = undefined,
    awaiting = false,
): Scope {
    /* Eager unless awaiting adoption; `data()` lazily mints an empty doc if a body
       never created one (a stateless component that still reaches for its scope). */
    let document: Doc | undefined = awaiting ? undefined : createDoc(initial)
    const data = (): Doc => (document ??= createDoc({}))
    /* The scope's serialization-stable id: the ambient render-path when created inside a render
       (route + layout + branch/row + component ordinal, composed by `withPath` at each nesting
       site), else the run-unique counter for a detached scope. Snapshotted at creation, so a
       nested push doesn't mutate an ancestor's id. */
    const renderPath = CURRENT_PATH.current
    const id =
        renderPath !== ''
            ? renderPath
            : parent === undefined
              ? `scope-${nextId++}`
              : `${parent.id}.${nextId++}`
    /* Doc-state warm-seed (client hydration only): a plain `state(initial)` re-runs its initializer
       on the client, so a uuid/timestamp/random would diverge from the SSR HTML. The server snapshot
       for this scope's render-path id is decoded here and consumed by `replace` on each slot's FIRST
       write (the eager init), keeping the server value while the throwaway init is discarded. One-shot
       via `consumeSeed` (two-phase, ADR-0048) — an SPA re-nav to the same path re-inits fresh, and a
       hydration-desync throw hands the seed to the cold rebuild; empty on the server. */
    let pendingSeed: Map<string, unknown> | undefined
    /* `DOC_SEED` is populated only on the client by `startClient` (empty on the server), so the read
       needs no window guard — it mirrors the async-cell warm read. */
    const encodedSeed = consumeSeed(DOC_SEED, id)
    if (encodedSeed !== undefined) {
        try {
            pendingSeed = new Map(
                Object.entries(decodeRefJson(encodedSeed) as Record<string, unknown>),
            )
        } catch {
            /* A corrupt seed falls back to a cold init — the same failure mode as a warm cell. */
        }
    }
    /* Server: register this scope's doc snapshot for the `__SSR__.docs` warm-seed, keyed by its
       render-path id. Lazy — taken at render-return, after the synchronous state inits have run.
       Only a rendered scope (stable render-path id) registers; a detached scope (counter id) and the
       client never do. An empty/unused doc is dropped at the stamp, so a stateless scope costs only
       the push. */
    if (typeof window === 'undefined' && renderPath !== '') {
        docSnapshotsSlot.get()?.entries.push({ id, take: () => document?.snapshot() })
    }
    /* Adopted build teardowns (the reactivity stopper from the mount core). Disposed
       first and in reverse on teardown — so the one `dispose` runs the order the call sites
       hand-composed as `stop(); lexical.dispose()`. */
    const owned: Array<() => void> = []
    /* Context values shared down the tree, held apart from the reactive doc (which
       a child does not inherit): keyed by name, read by the closest ancestor walk. */
    const shared = new Map<string, unknown>()
    /* Per-component monotonic index for the async cells constructed under this scope, in
       declaration order — the local half of a cell's serialization-stable warm-seed key
       (`${scope.id}:${index}`, see `createAsyncCell`). Per-scope (not global) so a client-only
       sibling component can't shift another component's cell keys: divergence stays local. Both
       SSR and client construct a component's cells in the same order, so the indices agree — but
       ONLY because every cell that CAN become async draws exactly one index per construction,
       independent of whether it materializes as async on a given render. `computed` gets this from
       its static `isAsyncFunction` routing; `linked` decides at runtime (it draws in
       `createAsyncCell` when its seed suspends, else RESERVES the index in its plain-`state`
       fall-through), so a `linked` whose blocking dep is in flight on the server but warm on the
       client still occupies its one slot on both sides. Break that "exactly one per construction"
       rule and every downstream cell keys off-by-one across the handoff. */
    let cellIndex = 0

    /* `cell` and `nextCellIndex` are not on the public `Scope` type — `cell` is the compiler-only
       cell-hoisting leaf; `nextCellIndex` is drawn by `createAsyncCell` for its warm-seed key.
       Both stay on the runtime object but off the documented surface. */
    const self: Scope & { cell: <T>(path: string) => Cell<T>; nextCellIndex: () => number } = {
        id,
        nextCellIndex: () => cellIndex++,
        parent,
        read: (path) => data().read(path),
        /* Consume-once seed adoption: on the client's hydrating build, the FIRST write to each seeded
           slot is the eager `state(initial)` init — swap in the server value and drop the seed, so a
           `state(uuid())` keeps the SSR value while its throwaway fresh init is discarded. Every later
           write (a real reassignment) and every non-seeded path passes straight through. */
        replace: (path, value) => {
            if (pendingSeed?.has(path)) {
                const seeded = pendingSeed.get(path)
                pendingSeed.delete(path)
                return data().replace(path, seeded)
            }
            return data().replace(path, value)
        },
        add: (path, value) => data().add(path, value),
        remove: (path) => data().remove(path),
        apply: (patch) => data().apply(patch),
        cell: (path) => data().cell(path),
        derive: (path, compute) => data().derive(path, compute),
        snapshot: () => data().snapshot(),
        /* The reactive primitives — namespaced under the scope but AMBIENT-bound, not
           receiver-bound: each binds whatever scope is rendering and the finest ambient
           build window (branch/row), so the handle is namespacing, not a binding target.
           Binding to the receiver would leak branch-local cells (see ADR-0012). */
        state,
        linked,
        computed,
        trackedComputed,
        effect,
        own: (dispose) => {
            owned.push(dispose)
        },
        /* Reference store — no tracking, so a lookup never subscribes; reactivity comes
           from what is shared (a scope, whose doc is reactive), not from the share. */
        share: (key, value) => {
            shared.set(key, value)
        },
        /* Closest-ancestor resolve: own map first (self can read what it shared), then
           defer up via each scope's own `shared`. `has` distinguishes a shared
           `undefined` from "not provided"; undefined at the root means no provider. */
        shared: <T>(key: string): T | undefined =>
            shared.has(key) ? (shared.get(key) as T) : parent?.shared<T>(key),
        dispose: () => {
            /* Stop the build's reactivity in reverse order — the order the call sites
               hand-composed as `stop(); lexical.dispose()`. */
            for (let index = owned.length - 1; index >= 0; index -= 1) {
                owned[index]?.()
            }
            owned.length = 0
            shared.clear()
        },
    }
    return self
}
