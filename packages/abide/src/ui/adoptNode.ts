import { RAW_CLOSE, RAW_OPEN } from '#shared/RAW_RUN.ts'
import { Mismatch } from './Mismatch.ts'
import { type RawRun, rawCloseOf, rawRunEndingAt } from './RawRun.ts'
import { REGION_CAUGHT, REGION_OPEN } from './REGION.ts'
import { closeOf, type Region } from './regions.ts'

// WHERE A NODE IS WHEN THE SERVER ALREADY WROTE IT — the adopt half of every region's mount: the
// page, an arm, a slot, a caller's children and every row. The compiler emits it from the walk that
// wrote the markup (`Cursor`) — the same positions a row's build is made from — so where a node
// stands is never computed twice.
//
// THE GUARANTEE IS ABOUT PROVENANCE, NOT ABOUT RUNTIME SHAPE. A painter object reached the same
// end through runtime polymorphism and charged 1.5x a row for it (`bun run bench:reorder`, against
// inline construction) — a 2-shape property load per node, forever, for something a compiler can
// settle at build time.
//
// TWO KINDS OF HELPER. `runHere` and `regionHere` are STEPS the walk takes and never throw: on
// a page the walk stands outside every guard, so a node missing near the top must not take every
// binding below it down too. `elementHere`, `textHere` and `regionFound` are CHECKS a unit makes
// on the node it was handed, and they are where 41.10 refuses.
//
// SO THESE ARE HELPERS AND NOT AN INTERFACE. One shape each, no `this`, nothing to dispatch on —
// small enough for an engine to inline, where a method on one of two painter classes is not.
//
// AND THE CHECKS ARE WHAT KEEP A DISAGREEMENT LOCAL. The walk steps past a node of the wrong KIND
// by position, as a path did, so only the unit that needed it is refused (41.10). A node MISSING
// or EXTRA shifts everything after it in that parent — for a walk and for a path alike — and the
// kind check catches the shift wherever it lands on a different kind. What no check can see is a
// text node standing where a different text node was due, and that is what the equivalence gates
// (`nesting.test.ts`, `corpusRuns.test.ts`) are for.
export function elementHere(
    node: Node | null | undefined,
    tag: string,
): Element {
    if (
        node == null ||
        node.nodeType !== 1 ||
        (node as Element).localName !== tag
    )
        throw new Mismatch(
            `abide: expected <${tag}> where the client walked, so the client and the server disagree about this region's shape (41.10).`,
        )
    return node as Element
}

// A RUN, CHECKED: its text node, or — where the run holds markup (32.27) — the pair around it, read
// back from the closing anchor the walk stood on (`runHere`). A run the server rendered as no node
// was put back by the walk as it passed, so by the time a binding asks something is there — and
// where the walk could not put one back, this is what refuses.
export function textHere(node: Node | null | undefined): Text | RawRun {
    if (node != null) {
        if (node.nodeType === 3) return node as Text
        if (node.nodeType === 8 && (node as Comment).data === RAW_CLOSE) {
            const run = rawRunEndingAt(node as Comment)
            if (run !== null) return run
        }
    }
    throw new Mismatch(
        "abide: text was due where the server wrote none, so the client and the server disagree about this region's shape (41.10).",
    )
}

// WHERE A RUN THAT CAN HOLD MARKUP ENDS, and it NEVER THROWS — a STEP, for the reason every step is
// one. A run the server wrote as text is its one node; a run it wrote holding markup (32.27) is an
// anchor pair with any number of nodes between, and the walk stands on the CLOSE, so the position
// after it is found by `nextSibling` either way and nothing about the cursor changes.
//
// AND 32.24'S HOLE, where `parent` is given: a BLANK run the server rendered as no node still has to
// be a position, because every sibling after it is found from it — so the walk puts it back as it
// passes, whether or not anything binds it. A run that is not blank passes no parent and is never
// put back. `textHere` is the CHECK a binding makes; this is the step a walk takes, and on a page
// the walk is outside every guard, so a throw here would take down every unit after it rather than
// the one that disagreed.
//
// A node put back at the TOP of a row needs nothing more: a row with several top-level nodes is the
// RANGE from its anchor to `closeOf(anchor, true)`, and the node is put back inside it.
export function runHere(
    node: Node | null | undefined,
    parent: Node | null | undefined,
): Node | null | undefined {
    if (node != null) {
        if (node.nodeType === 3) return node
        if (node.nodeType === 8 && (node as Comment).data === RAW_OPEN)
            return rawCloseOf(node) ?? node
    }
    if (parent == null) return node
    const made = (parent.ownerDocument as Document).createTextNode('')
    parent.insertBefore(made, node ?? null)
    return made
}

// A REGION'S ANCHOR PAIR, taken where the walk stands rather than counted to from a root — and it
// never throws either, for `runHere`'s reason: the walk continues from the pair's CLOSE, so a
// region the server did not write here answers `undefined` and the walk carries on as far as it
// can. What refuses is `regionFound`, in the unit that needed the region.
//
// The close is the one at DEPTH ZERO: a region nested inside this one has anchors of its own.
export function regionHere(node: Node | null | undefined): Region | undefined {
    if (node == null || node.nodeType !== 8) return undefined
    const data = (node as Comment).data
    if (data !== REGION_OPEN && data !== REGION_CAUGHT) return undefined
    const close = closeOf(node, false)
    return close === null ? undefined : { open: node as Comment, close }
}

export function regionFound(region: Region | undefined): Region {
    if (region === undefined)
        throw new Mismatch(
            "abide: a region was due where the client walked, so the client and the server disagree about this region's shape (41.10).",
        )
    return region
}
