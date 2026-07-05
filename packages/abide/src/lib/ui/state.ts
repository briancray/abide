import { computed } from './computed.ts'
import { linked } from './linked.ts'
import { createSignalNode } from './runtime/createSignalNode.ts'
import { readNode } from './runtime/readNode.ts'
import type { State } from './runtime/types/State.ts'
import { writeNode } from './runtime/writeNode.ts'
import { scope } from './scope.ts'

/* The imported reactive surface: the `state` callable plus its attached members.
   `state`/`state.linked`/`state.computed` are the reactive primitives an author
   imports (`import { state } from '@abide/abide/ui/state'`); the compiler resolves
   the import binding (alias-safe) and lowers each onto the ambient scope. `.share`/
   `.shared` are the context seam — the reference store the runtime scope exposes,
   reached ambiently so a component can pass a named value down its subtree. */
type StateFn = {
    /* No-arg form for an undefined initial with a declared type: `state<Foo>()` is
       `State<Foo | undefined>`. Without it `state<Foo>(undefined)` is an arity/assign
       error and `state(undefined)` infers `T = undefined` (every `.value` access then
       narrows to `never`). */
    <T>(): State<T | undefined>
    <T>(initial: T, transform?: (next: T, previous: T) => T): State<T>
    /* A writable cell reseeded from a reactive thunk (`state.linked(() => src())`). */
    linked: typeof linked
    /* A read-only cell computed from other cells (`state.computed(() => a() + b())`). */
    computed: typeof computed
    /* Puts a named value on the ambient scope, read down the tree by `state.shared`. */
    share: (key: string, value: unknown) => void
    /* Reads the closest ancestor scope that shared `key`; undefined if none provided. */
    shared: <T>(key: string) => T | undefined
}

/*
A writable reactive cell — abide's from-scratch reactive primitive, with no
compiler sigil and no external reactivity-library import. `.value` is a
plain getter/setter over a signal node, so a read/write shows up as exactly that
in a stack trace. Imported and called bare (`let count = state(0)`); the compiler
resolves the `state` import binding (alias-safe), desugars plain `state(initial)` to
a serializable `model` doc slot, and keeps `state(initial, transform)` as a `.value`
cell routed onto the ambient scope; the runtime needs no magic.

`transform` is an optional coercion gate on the write path: every `.value =`
runs it and stores what it returns, with `previous` for clamp-relative writes or
rejection (`return previous` is an `Object.is` no-op). It is the local-truth
mirror of `computed`'s write-through `set` — here the value lives in this cell, so
the gate *returns* what to store rather than writing an external target. The
construction `initial` is taken verbatim; the gate runs on writes only.
*/
function stateCell<T>(initial?: T, transform?: (next: T, previous: T) => T): State<T | undefined> {
    const node = createSignalNode(initial)
    return {
        get value(): T | undefined {
            return readNode(node) as T | undefined
        },
        set value(next: T | undefined) {
            writeNode(node, transform === undefined ? next : transform(next as T, node.value as T))
        },
    }
}

const stateFn = stateCell as StateFn
stateFn.linked = linked
stateFn.computed = computed
/* `.share`/`.shared` route onto the ambient scope, read/written at call time so the
   state ↔ scope module cycle resolves. */
stateFn.share = (key: string, value: unknown): void => {
    scope().share(key, value)
}
stateFn.shared = <T>(key: string): T | undefined => scope().shared<T>(key)

// @documentation reactive-state
export const state = stateFn
