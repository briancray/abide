import { advanceClaim } from '../runtime/advanceClaim.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { appendText } from './appendText.ts'

/*
A reactive `{expr}` interpolation mounted at a skeleton anchor comment (`<!--a-->`), used
for reactive text INTERLEAVED with element siblings (where element-only positioning can't
reach it). The anchor is located by `skeleton`'s scan, and content mounts immediately
after it. Handles the same three value kinds as `appendText` — escaped text, a
`{snippet(args)}` builder, and `html\`\``-branded raw markup — since the kind is only
known at runtime.

The anchor is KEPT (in both the SSR markup and the client DOM, like control flow's
`<!--[-->` range markers), so server and client render identical markup — `appendTextAt`
never strips it.

Both paths delegate to `appendText`: hydrate with the cursor temporarily pointed at the
anchor's content (the server rendered `<!--a-->value`, so the value is the anchor's next
sibling), create with the anchor's next sibling as the insertion reference — one
text-split / snippet / raw-html implementation, positioned two ways.
*/
// @documentation plumbing
export function appendTextAt(anchor: Node, read: () => unknown): void {
    const parent = anchor.parentNode as Node
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const had = hydration.next.has(parent)
        const saved = hydration.next.get(parent)
        advanceClaim(hydration, parent, anchor)
        appendText(parent, read)
        if (had) {
            hydration.next.set(parent, saved ?? null)
        } else {
            hydration.next.delete(parent)
        }
        return
    }
    appendText(parent, read, false, anchor.nextSibling)
}
