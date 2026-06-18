import { rawHtmlString } from '../../shared/html.ts'
import { snippetPayload } from '../../shared/snippet.ts'
import { effect } from '../effect.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { appendSnippet } from './appendSnippet.ts'
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

Hydrate delegates to `appendText` with the cursor temporarily pointed at the anchor's
content (the server rendered `<!--a-->value`, so the value is the anchor's next sibling),
reusing its text-split / snippet / raw-html claiming.
*/
// @readme plumbing
export function appendTextAt(anchor: Node, read: () => unknown): void {
    const parent = anchor.parentNode as Node
    if (RENDER.hydration !== undefined) {
        const hydration = RENDER.hydration
        const had = hydration.next.has(parent)
        const saved = hydration.next.get(parent)
        hydration.next.set(parent, anchor.nextSibling)
        appendText(parent, read)
        if (had) {
            hydration.next.set(parent, saved ?? null)
        } else {
            hydration.next.delete(parent)
        }
        return
    }

    const first = read()
    if (typeof snippetPayload(first) === 'function') {
        const fragment = document.createDocumentFragment()
        appendSnippet(fragment, read)
        parent.insertBefore(fragment, anchor.nextSibling)
        return
    }
    if (rawHtmlString(first) !== undefined) {
        let nodes: Node[] = []
        effect(() => {
            for (const node of nodes) {
                parent.removeChild(node)
            }
            const holder = document.createElement('div')
            holder.innerHTML = rawHtmlString(read()) ?? ''
            nodes = [...holder.childNodes]
            /* Insert the fresh markup just after the anchor (its live re-insertion point). */
            const after = anchor.nextSibling
            for (const node of nodes) {
                parent.insertBefore(node, after)
            }
        })
        return
    }
    const node = document.createTextNode('')
    parent.insertBefore(node, anchor.nextSibling)
    effect(() => {
        node.data = String(read())
    })
}
