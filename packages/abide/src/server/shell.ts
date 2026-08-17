// The document a page is served IN — the app's own HTML, with a hole where the page goes.
//
// A framework that owns the whole document owns the one file an app most wants to write itself: the
// `<html lang>`, the fonts, the meta tags, the analytics snippet somebody's marketing team needs, the
// class on `<body>` a theme reads. So abide does not build one. It takes the app's `app.html`, finds
// the hole, and renders into it — which makes the shell an ORDINARY html file that a browser can open
// and an editor can highlight, rather than a template in a language of its own.
//
// The hole is `<slot></slot>`, and that is not a new word: it is what `<slot/>` already means in a
// `.abide` file — "the thing below me renders here". One word for one relationship. It is also the
// one element in HTML that is `display: contents` by default, so the container abide hydrates into
// costs the page no box and no layout.
//
// Split ONCE, into four pieces, because two of the cuts are where abide has something to insert: the
// scoped `<style>` blocks go at the end of the head, and everything else the render writes goes
// inside the slot. The third cut is the close of the hydration root, which is a boundary rather than
// an insertion point — see `close`. Splitting per request would be re-parsing a file that cannot
// have changed.

/**
 * An app's document, cut at the two places a render writes into.
 *
 * Concatenated in this order: `head` + the scoped styles + `open` + the page + `close` + `tail`.
 */
export interface Shell {
    /** Everything up to where the scoped styles go — the text before `</head>`. */
    head: string
    /** The rest of the head, and the body down to the inside of the slot. */
    open: string
    /**
     * The close of the hydration ROOT, and nothing after it.
     *
     * Split from `tail` because the boundary is load-bearing and was implicit: everything between
     * `open` and this is what a client ADOPTS, so anything written inside it has to be something the
     * client's own render produces too. A `<script>` of seeded values is not — it was emitted here,
     * survived only because hydration read it before discarding it as an extra child, and left a
     * stray element inside the content for any reader that runs no scripts.
     */
    close: string
    /** From after the hydration root to the end of the document. Where anything the client must not adopt goes. */
    tail: string
}

// `<slot>`, `<slot/>`, `<slot />`, or one carrying attributes. The closing tag is matched with it so
// a shell may put a placeholder inside — `<slot>loading…</slot>` is legible in an editor and is
// REPLACED by the page, which is what makes the file openable on its own.
const HOLE = /<slot\b[^>]*?(\/?)>(?:[\s\S]*?<\/slot\s*>)?/gi

// A comment is not markup, and a document that EXPLAINS its own slot in one is the first document
// anybody writes: this file's own example did it, and rendered the page inside the paragraph
// describing where pages render. Found once and skipped, rather than stripped — the comment is the
// app's and goes out with the rest of its document.
const COMMENT = /<!--[\s\S]*?-->/g

// Case-insensitive, because an app's own html is written by a person: `</HEAD>` is the same document.
const HEAD_END = /<\/head\s*>/gi

/**
 * An app's html as a shell. THROWS when there is nowhere to render.
 *
 * A missing `<slot></slot>` is a refusal rather than a guess — appending the page to `<body>` would
 * be abide deciding where an app's own document puts its content, and the failure of that guess is a
 * page rendered outside the layout somebody wrote. It is read once, at boot, so the message arrives
 * before anything is serving.
 */
export function shell(html: string): Shell {
    // Scanned once and asked twice: both patterns skip the same comments, and `commented` walks the
    // whole document to find them.
    const ranges = commented(html)
    const hole = first(HOLE, html, ranges)
    if (hole === null) {
        throw new Error(
            'abide: this shell has no <slot></slot>, and that is where a page renders. Add one inside <body>; whatever is inside it is a placeholder the page replaces.',
        )
    }
    // The slot's TAGS stay in the document and the page renders between them, so the hydrating
    // client has a container to adopt into. Replacing the element instead would leave the page's
    // nodes as children of whatever the slot happened to sit in.
    //
    // A self-closing slot is not HTML — a browser reads `<slot/>` as an opening tag — but it is what
    // a person writes, and the two are the same intent. Written out as a pair.
    const opening = hole[1] === '/' ? '<slot>' : hole[0].slice(0, hole[0].indexOf('>') + 1)
    const before = `${html.slice(0, hole.index)}${opening}`

    // The styles go at the end of the HEAD, so the split is there — and `null` means this shell has
    // no head at all, which is legal: a fragment shell is still a document with a hole in it, and the
    // styles then simply lead. `before` is a PREFIX of `html`, so the ranges still locate its
    // comments — the ones past the cut simply never match.
    const headEnd = first(HEAD_END, before, ranges)
    return {
        head: headEnd === null ? '' : before.slice(0, headEnd.index),
        open: headEnd === null ? before : before.slice(headEnd.index),
        close: '</slot>',
        tail: html.slice(hole.index + hole[0].length),
    }
}

/** Where the comments are. A fact about text rather than a primitive, so it stays in this file. */
interface Range {
    from: number
    to: number
}

/**
 * Every `<!-- … -->` in a document.
 *
 * Scanned once for both of the patterns below, because they follow the same rule for the same
 * reason: a document that explains itself in a comment must not have the explanation acted on.
 */
function commented(html: string): Range[] {
    const ranges: Range[] = []
    COMMENT.lastIndex = 0
    for (let found = COMMENT.exec(html); found !== null; found = COMMENT.exec(html)) {
        ranges.push({ from: found.index, to: found.index + found[0].length })
    }
    return ranges
}

/** Whether a position falls inside one of them. */
function within(ranges: Range[], at: number): boolean {
    for (const range of ranges) if (at >= range.from && at < range.to) return true
    return false
}

/**
 * The first match that is really in the document rather than in a comment ABOUT the document.
 *
 * A document that explains its own `<slot>` in a comment is the first document anybody writes — this
 * repo's own did — and acting on the explanation renders the page inside the paragraph describing
 * where pages render. `pattern` must be global; `lastIndex` is reset here so a module-level one is
 * safe to reuse.
 */
function first(pattern: RegExp, html: string, ranges: Range[]): RegExpExecArray | null {
    pattern.lastIndex = 0
    for (let found = pattern.exec(html); found !== null; found = pattern.exec(html)) {
        if (!within(ranges, found.index)) return found
    }
    return null
}

/**
 * Abide's own document, opened — what a shell that is not an app's own begins with.
 *
 * The `lang` and the charset are here rather than left to a caller because a document without them
 * is wrong in a way a browser papers over: it guesses an encoding, and the guess is right until the
 * first non-ASCII byte. A caller writing its own `<meta charset>` gets it too, inside `head`, and the
 * first one in a document is the one that counts.
 */
export const DOCUMENT_OPEN = '<!doctype html><html lang="en"><head><meta charset="utf-8">'

/** What `renderDocument(head, …)` means: abide's own document, with the app's head inside it. */
export function shellAround(head: string): Shell {
    // No slot at all in this form, so the hydration root is the body and there is nothing between the
    // two — `close` is empty and everything is `tail`.
    return { head: `${DOCUMENT_OPEN}${head}`, open: '</head><body>', close: '', tail: '</body></html>' }
}
