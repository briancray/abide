import { effect } from '../effect.ts'

/*
A text node whose content tracks `read()`. The effect captures whatever reactive
cells `read` touches, so the node — and only this node — re-renders when they
change. This is the leaf the compiler emits for a `{expr}` interpolation: one
text node, one effect, fine-grained like Svelte's compiled text.
*/
// @readme plumbing
export function text(read: () => unknown): Text {
    const node = document.createTextNode('')
    effect(() => {
        node.data = String(read())
    })
    return node
}
