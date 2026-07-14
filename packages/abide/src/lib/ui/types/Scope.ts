import type { computed } from '../computed.ts'
import type { effect } from '../effect.ts'
import type { linked } from '../linked.ts'
import type { Patch } from '../runtime/types/Patch.ts'
import type { state } from '../state.ts'
import type { trackedComputed } from '../trackedComputed.ts'

/*
A lexical scope: the unit that owns a region's reactive data, its lifetime, and
the capabilities applied to it. This is the INTERNAL shape — the compiler's lowering
host and the runtime object; it is no longer the author surface. The author reactive
surface is the imported `state`/`state.linked`/`state.computed`/`effect` (see
`state.ts`); the compiler resolves those import bindings and lowers each onto this
scope (`$$scope().derive`/`.linked`/`.effect`, `state.share`/`.shared` → `share`/
`shared`). The data surface MIRRORS `Doc` (read/replace/add/remove/derive/apply/
snapshot) so the compiler can target a scope as a component's data binding directly;
it passes values down the tree as context (`share`/`shared`).

The reactive primitives remain on this internal shape because the lowered runtime calls
them (`$$scope().linked(...)`) — they are withdrawn from the AUTHOR-facing public surface
(docs/examples), not the runtime object.
*/
export type Scope = {
    readonly id: string
    readonly parent: Scope | undefined
    /* data — mirrors Doc */
    read: <T>(path: string) => T
    replace: (path: string, value: unknown) => unknown
    add: (path: string, value: unknown) => void
    remove: (path: string) => void
    apply: (patch: Patch) => void
    derive: <T>(path: string, compute: () => T) => () => T
    snapshot: () => unknown
    /* The reactive primitives — namespaced under the scope, but AMBIENT-bound, not
       receiver-bound (unlike the data methods above, which act on THIS scope's doc).
       `state`/`linked`/`computed`/`effect` create their cell in whatever scope is currently
       rendering and own their teardown to the finest ambient BUILD WINDOW — a control-flow
       branch or list row, not the whole component. So `someScope.computed(fn)` does NOT
       create state in someScope; the receiver is namespacing only, the cells bind the
       ambient window. Binding them to the receiver instead would leak a branch-local cell
       past a branch flip (the build window is finer-grained than the lexical scope — see
       ADR-0012). Forms: a writable `state(x, transform)` gate, a reseeding `linked`, the
       read-only `computed(compute)` (a writable computed does not exist — that write is
       expressed at the binding `bind:value={{ get, set }}`; the serializable computed doc
       slot is `derive` above), and `effect`, the reaction re-run on dep change (the SSR
       back-end strips it — effects are client lifecycle). */
    state: typeof state
    linked: typeof linked
    computed: typeof computed
    /* The eager stream-classifying read-only computed a bare-call `computed(getStream())`
       lowers to — auto-tracks a stream/promise producer, falls back to a lazy computed. */
    trackedComputed: typeof trackedComputed
    effect: typeof effect
    /* Adopts a teardown into this scope's lifetime — the build's reactivity stopper
       (effects/listeners), run first on `dispose` (before children, before capabilities).
       Internal: the mount core registers the build's disposer here so a component has ONE
       teardown (`dispose`) rather than a separate stop + dispose composed at every site. */
    own: (dispose: () => void) => void
    /* context — values shared DOWN the tree (not in the reactive doc, which doesn't
       inherit): `share` puts a named value on this scope; `shared` reads the closest
       ancestor (self included) that has the key, undefined if none. The value is held
       by reference, so reactive context = share a scope (its doc is reactive), not a
       plain object snapshot. */
    share: (key: string, value: unknown) => void
    shared: <T>(key: string) => T | undefined
    /* lifetime */
    dispose: () => void
}
