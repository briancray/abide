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
*/
// @readme plumbing
export function state<T>(initial: T): State<T> {
    const node = createSignalNode(initial)
    return {
        get value(): T {
            return readNode(node) as T
        },
        set value(next: T) {
            writeNode(node, next)
        },
    }
}
