import { effect } from '../../src/lib/ui/effect.ts'

/*
A text node whose content tracks `read()`. The effect captures whatever reactive
cells `read` touches, so the node — and only this node — re-renders when they
change: one text node, one effect — fine-grained granularity.

Plain-text only — `read()` is coerced with String(). For a `{expr}` interpolation
that may yield an `html\`…\`` or snippet value the compiler emits `appendText`,
which branches on the branded value and inserts raw markup; `text` cannot host
multiple nodes and would stringify such a value to `[object Object]`.
*/
export function text(read: () => unknown): Text {
    const node = document.createTextNode('')
    effect(() => {
        node.data = String(read())
    })
    return node
}
