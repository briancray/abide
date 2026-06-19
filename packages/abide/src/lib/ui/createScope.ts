import { computed } from './computed.ts'
import { history } from './history.ts'
import { linked } from './linked.ts'
import { persist as persistDoc } from './persist.ts'
import { createDoc } from './runtime/createDoc.ts'
import type { Doc } from './runtime/types/Doc.ts'
import { state } from './state.ts'
import { sync } from './sync.ts'
import type { History } from './types/History.ts'
import type { PersistHandle } from './types/PersistHandle.ts'
import type { Scope } from './types/Scope.ts'

/* A process-stable counter id. The serialization-stable LEXICAL id (route +
   component + tree position) that `persistent`/`sync` want across reloads/peers
   is stamped by the compiler later; until then a scope's id is unique within a
   run — enough for in-session undo and the bus, and as an explicit key's fallback. */
let nextId = 0

/*
Builds a lexical scope. Its data is a document — created eagerly from `initial`,
or (when `awaiting`) ADOPTED from the first `doc()` a component body creates under
it, so a scope can wrap the component's own model without changing the data
lowering. Data methods mirror `Doc` and delegate to that document; capabilities
are lazy (`undoable`/`persistent` attach `history`/`persist` to it on first call);
`child` nests; `dispose` tears the subtree down children-first.
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
    const id = parent === undefined ? `scope-${nextId++}` : `${parent.id}.${nextId++}`
    const children: Scope[] = []
    let past: History | undefined
    let persistence: PersistHandle | undefined
    let unsync: (() => void) | undefined

    const self: Scope = {
        id,
        parent,
        read: (path) => data().read(path),
        replace: (path, value) => data().replace(path, value),
        add: (path, value) => data().add(path, value),
        remove: (path) => data().remove(path),
        apply: (patch) => data().apply(patch),
        cell: (path) => data().cell(path),
        derive: (path, compute) => data().derive(path, compute),
        snapshot: () => data().snapshot(),
        /* The `.value`-cell signal forms, namespaced under the scope — standalone
           non-serializing cells (owned by the render scope), reached only here. */
        state,
        linked,
        computed,
        child: (childInitial = {}) => {
            const created = createScope(childInitial, self)
            children.push(created)
            return created
        },
        root: () => (parent === undefined ? self : parent.root()),
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
            for (const created of children) {
                created.dispose()
            }
            children.length = 0
            past?.dispose()
            past = undefined
            persistence?.dispose()
            persistence = undefined
            unsync?.()
            unsync = undefined
        },
    }
    return self
}
