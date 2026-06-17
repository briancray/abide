import { createSignalNode } from './runtime/createSignalNode.ts'
import { readNode } from './runtime/readNode.ts'
import type { State } from './runtime/types/State.ts'
import { writeNode } from './runtime/writeNode.ts'

/*
A writable reactive cell — abide's from-scratch reactive primitive, with no
compiler sigil and no external reactivity-library import. `.value` is a
plain getter/setter over a signal node, so a read/write shows up as exactly that
in a stack trace. The compiler's job (later) is only to auto-deref `{cell}` in
templates and tag this declaration as a serializable manifest slot; the runtime
needs no magic.

`transform` is an optional coercion gate on the write path: every `.value =`
runs it and stores what it returns, with `previous` for clamp-relative writes or
rejection (`return previous` is an `Object.is` no-op). It is the local-truth
mirror of `derived`'s write-through `set` — here the value lives in this cell, so
the gate *returns* what to store rather than writing an external target. The
construction `initial` is taken verbatim; the gate runs on writes only.
*/
// @readme plumbing
export function state<T>(initial: T, transform?: (next: T, previous: T) => T): State<T> {
    const node = createSignalNode(initial)
    return {
        get value(): T {
            return readNode(node) as T
        },
        set value(next: T) {
            writeNode(node, transform === undefined ? next : transform(next, node.value as T))
        },
    }
}
