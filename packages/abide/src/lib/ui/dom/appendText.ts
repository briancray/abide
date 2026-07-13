import { rawHtmlString } from '../../shared/html.ts'
import { snippetPayload } from '../../shared/snippet.ts'
import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { SuspenseSignal } from '../runtime/SuspenseSignal.ts'
import { appendSnippet } from './appendSnippet.ts'
import { assertClaimedText } from './assertClaimedText.ts'
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
        const claimed = claimChild(hydration, parent)
        /* Nullish reads render as empty text, never the literal `"undefined"` — so a
           pending async read (undefined-while-pending, ADR-0032 D3) shows nothing. A blocking
           read never suspends here (warm-seeded → `refreshing()`), so `probe` holds its value. */
        const firstValue = probe
        const value = firstValue == null ? '' : String(firstValue)
        /* A value that first rendered empty produced NO server text node, so the cursor
           points at the following node (an element/comment) or past the end (null) — not a
           text node to claim. Bind to a Text node either way: claim the merged SSR node when
           one is here, else synthesize an empty one at the cursor and leave the claimed node
           for the next consumer (a following element hole, a sibling binding, or nothing).
           Without this the bind effect below derefs a null/element `node`. A text node is
           detected by `splitText` (not `nodeType`), so the test mini-dom is covered too. */
        const isText = claimed !== null && typeof (claimed as Text).splitText === 'function'
        const node = (
            isText ? claimed : parent.insertBefore(document.createTextNode(''), claimed)
        ) as Text
        /* The claimed SSR node must begin with this binding's value, or the split below
           lands mid-run and orphans the tail — throw legibly at the divergence instead. A
           synthesized empty node is this binding's own, so there's nothing to disagree. */
        if (isText) {
            assertClaimedText(node, value)
        }
        /* Peel this binding's text off the merged SSR node. A non-final binding in a
           run (`splitAlways`) splits even when it consumes the whole node, leaving an
           empty node for the next binding — otherwise an interpolation that renders to
           empty string (or whose followers do) has no node and the next claim grabs the
           wrong sibling. The final binding keeps `<` so it doesn't leave a stray node a
           following element would claim. A synthesized node is already this binding's own,
           so it never splits. */
        if (
            isText &&
            (splitAlways ? value.length <= node.data.length : value.length < node.data.length)
        ) {
            node.splitText(value.length)
        }
        /* Advance past the claimed text node; for a synthesized node leave the cursor on the
           still-unclaimed `claimed` node it was inserted before (an element/comment, or null
           at the end). */
        hydration.next.set(parent, isText ? node.nextSibling : claimed)
        effect(() => {
            node.data = readTextOrSuspend(read)
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
