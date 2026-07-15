import { rawHtmlString } from '../../shared/html.ts'
import { snippetPayload } from '../../shared/snippet.ts'
import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { parkCursor } from '../runtime/parkCursor.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { SuspenseSignal } from '../runtime/SuspenseSignal.ts'
import { appendSnippet } from './appendSnippet.ts'
import { claimText } from './claimText.ts'
import { isComment } from './isComment.ts'
import { parseRawNodes } from './parseRawNodes.ts'
import { readTextOrSuspend } from './readTextOrSuspend.ts'

const CLOSE = '/abide:html'

/*
A reactive `{expr}` interpolation under `parent`. A plain value is an escaped text
node: created and appended (create), or the server-rendered text node claimed
(hydrate) and bound. Adjacent SSR text merges into one node, so on hydrate the
claimed node is split at the current value's length — deterministic, because
`read()` returns the same value the server rendered.

A value branded by `html\`…\`` (see abide/ui/html) inserts raw markup instead:
its parsed nodes go between an anchor (create), or the server-rendered nodes
between `<!--abide:html-->`/`<!--/abide:html-->` markers are adopted (hydrate), and
a change re-parses and swaps. A binding is text or raw for its lifetime (decided by
its first value), so plain text — the common case — stays a cheap single node.

A blocking `await` read that is pending throws a `SuspenseSignal` (ADR-0042): the
interpolation SUSPENDS — it renders empty and withholds until the value resolves,
never evaluating the surrounding expression against a pending `undefined`. The read
tracked the cell, so the bind effect re-runs on settle. A suspend can only occur on a
cold client render (on hydrate the warm-seed makes the cell `refreshing()`, not
`pending()`, D4), and a suspended value is treated as text — its snippet/html shape is
decided from the first resolved value.
*/
// @documentation plumbing
export function appendText(parent: Node, read: () => unknown, splitAlways = false): void {
    /* Probe the first value once, tolerating a suspend (a pending blocking read) — a suspended
       interpolation skips snippet/html detection and takes the text path, starting empty. */
    let probe: unknown
    let suspended = false
    try {
        probe = read()
    } catch (signal) {
        if (!(signal instanceof SuspenseSignal)) {
            throw signal
        }
        suspended = true
    }
    /* A snippet call (`{row(args)}`) mounts its builder; a `html\`\`` value inserts
       raw markup; everything else is escaped text — decided by the first value. */
    if (!suspended && typeof snippetPayload(probe) === 'function') {
        appendSnippet(parent, read)
        return
    }
    if (!suspended && rawHtmlString(probe) !== undefined) {
        appendRawHtml(parent, read)
        return
    }
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        /* Nullish reads render as empty text, never the literal `"undefined"` — so a
           pending async read (undefined-while-pending, ADR-0032 D3) shows nothing. A blocking
           read never suspends here (warm-seeded → `refreshing()`), so `probe` holds its value. */
        const firstValue = probe
        const value = firstValue == null ? '' : String(firstValue)
        /* Claim this binding's portion of the merged SSR text node (assert + split +
           advance — see `claimText`). A value that first rendered empty produced NO server
           text node, so the cursor points at the following node (an element/comment) or past
           the end — the miss arm: bind a synthesized empty Text at the cursor and leave the
           unclaimed node for the next consumer (a following element hole, a sibling binding,
           or nothing). Without it the bind effect below derefs a null/element node. */
        let node = claimText(hydration, parent, value, splitAlways)
        if (node === undefined) {
            const unclaimed = claimChild(hydration, parent)
            node = parent.insertBefore(document.createTextNode(''), unclaimed)
            /* Pin the cursor on the still-unclaimed node — the synthesized node is this
               binding's own, and an unset cursor would default back to the (now synthesized)
               first child. */
            parkCursor(hydration, parent, unclaimed)
        }
        const bound = node
        effect(() => {
            bound.data = readTextOrSuspend(read)
        })
        return
    }
    const node = document.createTextNode('')
    parent.appendChild(node)
    effect(() => {
        node.data = readTextOrSuspend(read)
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
        /* Insert/remove via the anchor's LIVE parent, not the build-time `parent` — when
           this interpolation is a bare child of a control-flow branch, `parent` is the
           branch's build fragment, which the enclosing block has since emptied into the
           document (same reason each/awaitBlock use the anchor's parentNode). */
        const liveParent = anchor.parentNode ?? parent
        for (const node of nodes) {
            liveParent.removeChild(node)
        }
        nodes = parseRawNodes(liveParent, value)
        for (const node of nodes) {
            liveParent.insertBefore(node, anchor)
        }
    }

    if (hydration !== undefined) {
        const open = claimChild(hydration, parent)
        let node: Node | null = open === null ? null : open.nextSibling
        while (node !== null && !isComment(node, CLOSE)) {
            nodes.push(node)
            node = node.nextSibling
        }
        parkCursor(hydration, parent, node === null ? null : node.nextSibling)
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
