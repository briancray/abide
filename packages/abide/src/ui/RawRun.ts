import { RAW_CLOSE, RAW_OPEN } from '#shared/RAW_RUN.ts'
import { Mismatch } from './Mismatch.ts'
import { parseMarkup } from './parseMarkup.ts'
import { removeUntil } from './regions.ts'

/**
 * A live text run while it holds markup: its anchor pair and the markup last parsed between them.
 *
 * 32.26 — a run holding text is its text node and nothing else, so this exists only while a `Raw`
 * is in the run — the ordinary slot allocates none of it (`setText`, `setMarkup`).
 *
 * `html` IS UNDEFINED FOR A RUN THE SERVER PAINTED. What is between the anchors is what the server
 * parsed from the same value, so the first write keeps it (`setMarkup`) the way a hydrated arm keeps
 * the arm it was painted with — reading markup back out of nodes is a serialisation, and not the
 * string the server wrote.
 */
export class RawRun {
    open: Comment
    close: Comment
    html: string | undefined

    constructor(open: Comment, close: Comment, html: string | undefined) {
        this.open = open
        this.close = close
        this.html = html
    }
}

/**
 * The run the walk found by its CLOSING anchor (`runHere`), read back to its opening one. Null
 * where the close has no open before it in its parent.
 */
export function rawRunEndingAt(close: Comment): RawRun | null {
    for (
        let node = close.previousSibling;
        node !== null;
        node = node.previousSibling
    )
        if (node.nodeType === 8 && (node as Comment).data === RAW_OPEN)
            return new RawRun(node as Comment, close, undefined)
    return null
}

/** The anchor that ends a run holding markup, or null where it is not closed in this parent. */
export function rawCloseOf(open: Node): Comment | null {
    for (let node = open.nextSibling; node !== null; node = node.nextSibling)
        if (node.nodeType === 8 && (node as Comment).data === RAW_CLOSE)
            return node as Comment
    return null
}

/**
 * A run holding text, turned into one holding `markup`: the text node gives way to the pair and
 * what the markup parses into.
 */
export function textToMarkup(text: Text, markup: string): RawRun {
    const parent = text.parentNode
    if (parent === null) throw detached()
    const document = text.ownerDocument
    const open = document.createComment(RAW_OPEN)
    const close = document.createComment(RAW_CLOSE)
    parent.insertBefore(open, text)
    parent.insertBefore(parseMarkup(text, markup), text)
    parent.replaceChild(close, text)
    return new RawRun(open, close, markup)
}

/** What stands between the anchors, replaced by what `markup` parses into. */
export function refillRun(run: RawRun, markup: string): void {
    const parent = run.close.parentNode
    if (parent === null) throw detached()
    clearRun(run)
    parent.insertBefore(parseMarkup(run.close, markup), run.close)
    run.html = markup
}

/**
 * A run holding markup, turned back into one holding text: the pair and everything between it
 * give way to one text node.
 */
export function markupToText(run: RawRun, text: string): Text {
    const parent = run.close.parentNode
    if (parent === null) throw detached()
    clearRun(run)
    run.open.remove()
    const node = run.close.ownerDocument.createTextNode(text)
    parent.replaceChild(node, run.close)
    return node
}

function clearRun(run: RawRun): void {
    removeUntil(run.open.nextSibling, run.close)
}

function detached(): Mismatch {
    return new Mismatch(
        "abide: this text run is not in a document, so the client and the server disagree about this region's shape (41.10).",
    )
}
