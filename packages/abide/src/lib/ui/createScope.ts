import { computed } from './computed.ts'
import { effect } from './effect.ts'
import { linked } from './linked.ts'
import { CURRENT_PATH } from './runtime/CURRENT_PATH.ts'
import { createDoc } from './runtime/createDoc.ts'
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
    label: string | undefined = undefined,
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
       SSR and client construct a component's cells in the same order, so the indices agree. */
    let cellIndex = 0

    /* `cell` and `nextCellIndex` are not on the public `Scope` type — `cell` is the compiler-only
       cell-hoisting leaf; `nextCellIndex` is drawn by `createAsyncCell` for its warm-seed key.
       Both stay on the runtime object but off the documented surface. */
    const self: Scope & { cell: <T>(path: string) => Cell<T>; nextCellIndex: () => number } = {
        id,
        nextCellIndex: () => cellIndex++,
        label,
        parent,
        read: (path) => data().read(path),
        replace: (path, value) => data().replace(path, value),
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
