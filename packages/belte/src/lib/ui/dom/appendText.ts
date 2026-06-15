import { effect } from '../effect.ts'
import { RENDER } from '../runtime/RENDER.ts'

/*
A reactive text node under `parent`: created and appended (create mode), or the
existing server-rendered text node claimed (hydrate mode) and bound for future
updates. Adjacent SSR text merges into one node, so on hydrate the claimed node is
split at the current value's length — deterministic, because `read()` returns the
same value the server rendered — leaving exactly this node's text to bind.
*/
// @readme plumbing
export function appendText(parent: Node, read: () => unknown): void {
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const index = hydration.index.get(parent) ?? 0
        hydration.index.set(parent, index + 1)
        const node = parent.childNodes[index] as unknown as Text
        const value = String(read())
        if (node !== undefined && value.length < node.data.length) {
            node.splitText(value.length)
        }
        effect(() => {
            node.data = String(read())
        })
        return
    }
    const node = document.createTextNode('')
    parent.appendChild(node)
    effect(() => {
        node.data = String(read())
    })
}
