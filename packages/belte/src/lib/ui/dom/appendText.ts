import { rawHtmlString } from '../../shared/html.ts'
import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'

const CLOSE = '/belte:html'

/*
A reactive `{expr}` interpolation under `parent`. A plain value is an escaped text
node: created and appended (create), or the server-rendered text node claimed
(hydrate) and bound. Adjacent SSR text merges into one node, so on hydrate the
claimed node is split at the current value's length — deterministic, because
`read()` returns the same value the server rendered.

A value branded by `html\`…\`` (see belte/shared/html) inserts raw markup instead:
its parsed nodes go between an anchor (create), or the server-rendered nodes
between `<!--belte:html-->`/`<!--/belte:html-->` markers are adopted (hydrate), and
a change re-parses and swaps. A binding is text or raw for its lifetime (decided by
its first value), so plain text — the common case — stays a cheap single node.
*/
// @readme plumbing
export function appendText(parent: Node, read: () => unknown): void {
    if (rawHtmlString(read()) !== undefined) {
        appendRawHtml(parent, read)
        return
    }
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const node = claimChild(hydration, parent) as unknown as Text
        const value = String(read())
        if (node !== null && value.length < node.data.length) {
            node.splitText(value.length)
        }
        hydration.next.set(parent, node === null ? null : node.nextSibling)
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

/* Raw-markup interpolation: parse the branded string into nodes behind an anchor,
   re-parsing on change; on hydrate adopt the server markup between its markers. */
function appendRawHtml(parent: Node, read: () => unknown): void {
    const hydration = RENDER.hydration
    const markup = (): string => rawHtmlString(read()) ?? ''
    const anchor = document.createTextNode('')
    let nodes: Node[] = []

    const set = (value: string): void => {
        for (const node of nodes) {
            parent.removeChild(node)
        }
        const holder = document.createElement('div')
        holder.innerHTML = value
        nodes = [...holder.childNodes]
        for (const node of nodes) {
            parent.insertBefore(node, anchor)
        }
    }

    if (hydration !== undefined) {
        const open = claimChild(hydration, parent)
        let node: Node | null = open === null ? null : open.nextSibling
        while (node !== null && !isComment(node, CLOSE)) {
            nodes.push(node)
            node = node.nextSibling
        }
        hydration.next.set(parent, node === null ? null : node.nextSibling)
        parent.insertBefore(anchor, node)
        let first = true
        effect(() => {
            const value = markup()
            if (first) {
                first = false // adopt the server markup as-is
                return
            }
            set(value)
        })
        return
    }

    parent.appendChild(anchor)
    effect(() => {
        set(markup())
    })
}

/* A comment node carrying exactly `data`. */
function isComment(node: Node, data: string): boolean {
    return (node as { data?: string }).data === data && node.childNodes.length === 0
}
