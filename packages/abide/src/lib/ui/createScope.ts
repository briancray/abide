import { computed } from './computed.ts'
import { effect } from './effect.ts'
import { history } from './history.ts'
import { linked } from './linked.ts'
import { trackedComputed } from './trackedComputed.ts'
import { persist as persistDoc } from './persist.ts'
import { createDoc } from './runtime/createDoc.ts'
import { liveScopes } from './runtime/liveScopes.ts'
import type { Cell } from './runtime/types/Cell.ts'
import type { Doc } from './runtime/types/Doc.ts'
import { state } from './state.ts'
import { sync } from './sync.ts'
import type { History } from './types/History.ts'
import type { PersistHandle } from './types/PersistHandle.ts'
import type { Scope } from './types/Scope.ts'

/* A process-stable counter id. The serialization-stable LEXICAL id (route +
   component + tree position) that `persist`/`broadcast` want across reloads/peers
   is stamped by the compiler later; until then a scope's id is unique within a
   run — enough for in-session undo and the bus, and as an explicit key's fallback. */
let nextId = 0

/*
Builds a lexical scope. Its data is a document — created eagerly from `initial`,
or (when `awaiting`) ADOPTED from the first `doc()` a component body creates under
it, so a scope can wrap the component's own model without changing the data
lowering. Data methods mirror `Doc` and delegate to that document; capabilities
are lazy (`record`/`persist` attach `history`/`persist` to it on first call);
`child` nests; `dispose` tears the subtree down children-first.
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
    const id = parent === undefined ? `scope-${nextId++}` : `${parent.id}.${nextId++}`
    const children: Scope[] = []
    /* Adopted build teardowns (the reactivity stopper from the mount core). Disposed
       first and in reverse on teardown, before children and capabilities — so the one
       `dispose` runs the order the call sites hand-composed as `stop(); lexical.dispose()`. */
    const owned: Array<() => void> = []
    /* Context values shared down the tree, held apart from the reactive doc (which
       a child does not inherit): keyed by name, read by the closest ancestor walk. */
    const shared = new Map<string, unknown>()
    let past: History | undefined
    let persistence: PersistHandle | undefined
    let unsync: (() => void) | undefined

    /* `cell` is not on the public `Scope` type — it is the compiler-only leaf the
       cell-hoisting lowering targets (`const _cell0 = $$scope().cell("path")`, see
       `hoistCells`). It stays on the runtime object but off the documented surface,
       so authors reach data through `read`/`replace`/`derive`, not a raw cell handle. */
    const self: Scope & { cell: <T>(path: string) => Cell<T> } = {
        id,
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
        child: (childInitial = {}) => {
            const created = createScope(childInitial, self)
            children.push(created)
            return created
        },
        root: () => (parent === undefined ? self : parent.root()),
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
        record: (options) => {
            past ??= history(data(), options)
        },
        persist: (key) => {
            persistence ??= persistDoc(data(), key ?? id)
        },
        broadcast: (transport) => {
            unsync ??= sync(data(), transport)
        },
        undo: () => past?.undo(),
        redo: () => past?.redo(),
        canUndo: () => past?.canUndo() ?? false,
        canRedo: () => past?.canRedo() ?? false,
        dispose: () => {
            /* Stop the build's reactivity first (reverse order), before tearing down nested
               children and the boundary-crossing capabilities — the order the call sites
               hand-composed as `stop(); lexical.dispose()`. */
            for (let index = owned.length - 1; index >= 0; index -= 1) {
                owned[index]?.()
            }
            owned.length = 0
            /* Children reverse too (last created first), so a later child that captured an
               earlier sibling tears down before the sibling it depends on — LIFO like `owned`. */
            for (let index = children.length - 1; index >= 0; index -= 1) {
                children[index]?.dispose()
            }
            children.length = 0
            shared.clear()
            past?.dispose()
            past = undefined
            persistence?.dispose()
            persistence = undefined
            unsync?.()
            unsync = undefined
            if (liveScopes.enabled) {
                liveScopes.scopes.delete(self)
            }
        },
    }
    /* Dev-only: register for the inspector's scope-tree view. Gated, so production
       never touches the set. */
    if (liveScopes.enabled) {
        liveScopes.scopes.add(self)
    }
    return self
}
