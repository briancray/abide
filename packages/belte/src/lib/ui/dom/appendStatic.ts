import { RENDER } from '../runtime/RENDER.ts'

/*
A static (non-reactive) text node under `parent`: created and appended (create
mode), or claimed from the server-rendered text (hydrate mode). As with reactive
text, a merged SSR text node is split at this literal's length so the next claim
lines up; nothing is bound since the text never changes.
*/
// @readme plumbing
export function appendStatic(parent: Node, value: string): void {
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const index = hydration.index.get(parent) ?? 0
        hydration.index.set(parent, index + 1)
        const node = parent.childNodes[index] as unknown as Text
        if (node !== undefined && value.length < node.data.length) {
            node.splitText(value.length)
        }
        return
    }
    parent.appendChild(document.createTextNode(value))
}
