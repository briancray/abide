import type { computed } from '../computed.ts'
import type { linked } from '../linked.ts'
import type { Cell } from '../runtime/types/Cell.ts'
import type { Patch } from '../runtime/types/Patch.ts'
import type { state } from '../state.ts'
import type { SyncTransport } from './SyncTransport.ts'

/*
A lexical scope: the unit that owns a region's reactive data, its lifetime, and
the capabilities applied to it. Its data surface MIRRORS `Doc` (read/replace/add/
remove/cell/derive/apply/snapshot) so the compiler can target a scope as a
component's data binding directly. It nests (`child`/`root`), and carries the
capability surface as methods so a scope is a passable value:
`<Child parentScope={scope} />`.

Capabilities route where the scope's changes go: `record()` to an undo journal,
`persist()` to durable storage, `broadcast()` to peers — declared once, then
`undo`/`redo` act on a recorded scope. `id` is the scope's identity for the
boundary-crossing capabilities — `persist()` defaults its key to it. `scope()` is
the ONLY public entry; everything else is a method reached through it (the
`history`/`persist`/`sync` helpers it composes are internal).
*/
export type Scope = {
    readonly id: string
    /* Dev-only display name (the host component/element it mounted into) for the
       inspector's Reactive tab; undefined for SSR/detached/child scopes. */
    readonly label?: string
    readonly parent: Scope | undefined
    /* data — mirrors Doc */
    read: <T>(path: string) => T
    replace: (path: string, value: unknown) => void
    add: (path: string, value: unknown) => void
    remove: (path: string) => void
    apply: (patch: Patch) => void
    cell: <T>(path: string) => Cell<T>
    derive: <T>(path: string, compute: () => T) => () => T
    snapshot: () => unknown
    /* the `.value`-cell signal forms, reachable only through a scope (the standalone
       `state`/`linked`/`computed` are no longer exported): a writable `state(x, transform)`
       gate, a reseeding `linked`, and the read-only `computed(compute)`. A writable
       computed does not exist — that write is expressed at the binding (`bind:value={{
       get, set }}`). The serializable computed doc slot is `derive` above. */
    state: typeof state
    linked: typeof linked
    computed: typeof computed
    /* tree */
    child: (initial?: unknown) => Scope
    root: () => Scope
    /* capabilities — enable where the scope's changes go */
    record: (options?: { limit?: number }) => void
    persist: (key?: string) => void
    broadcast: (transport: SyncTransport) => void
    /* undo/redo — act on a recorded scope */
    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
    /* lifetime */
    dispose: () => void
}
