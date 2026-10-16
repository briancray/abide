import type { PublishedWork } from './PUBLISHED_WORK.ts'

/**
 * What an op did to the DOM, one count per row, and what the subject published it did besides.
 *
 * Partitioned at the point of counting, and there is deliberately no accessor that adds the first
 * three rows up. Moving a COMMENT is 0.11 µs and moving an ELEMENT with its subtree is 2.8 µs —
 * 25x, because only the element is in the reflow — and on a 500-row reorder the reflow is 52% of
 * the op and identical however many markers moved with it. A single `nodesMoved` total is exactly
 * the number that made a marker-elision change worth 998 fewer records look worth writing; it
 * measured +0.053 ms on one run and −0.033 on the next, under the noise floor, and was dropped.
 *
 * There is no DURATION field. The counter runs inside the path it counts, so a number that is
 * both a count and a duration is a number taken with the instrument in the arm — `time()` throws
 * while the counters are armed, and the two are mutually exclusive passes over the same case body.
 */
export type Work = {
    /** Elements moved, with their subtrees. THE REFLOW: the renderer's gate is on this row. */
    elementsMoved: number
    /** Comment markers moved. Free, reported, and never summed with the row above. */
    markersMoved: number
    textMoved: number
    /**
     * `create*`, `cloneNode` and `importNode`.
     *
     * The compiled arm makes every row by clone, so a patch set without `cloneNode` reports 0 for
     * the whole arm while the vanilla arm reports 3 per row — the ratio upside down, not a small
     * miscount.
     */
    nodesCreated: number
    /** setAttribute / removeAttribute / toggleAttribute / the `className` setter. */
    attributesSet: number
    /**
     * `classList` mutations, apart from `attributesSet` and from each other.
     *
     * A class write is the cheapest way to move a rendered page and the easiest to do
     * redundantly, and it is the one write whose cost depends on whether a rule matches it —
     * byte-identical page source ran 4.5x apart on exactly this.
     */
    classWrites: number
    /**
     * `style.setProperty`, `removeProperty` and the `cssText` setter.
     *
     * An inline style write skips the cascade and is a different cost from a class, so it is a
     * different row.
     */
    styleWrites: number
    dataWrites: number
    /**
     * A `.data` write whose value the node already had.
     *
     * The renderer orders this row, and it cannot be read off the one above.
     */
    redundantDataWrites: number
    /**
     * `addEventListener` calls.
     *
     * NOT "bindings per row" — a keyed row calls it in neither arm, so the two would agree at
     * zero with the mechanism in AND out.
     */
    listenersBound: number
    /**
     * What each published source counted during the op, by source and then by field — the work a
     * prototype patch cannot see (`PUBLISHED_WORK.ts`).
     *
     * A source that published nothing has NO KEY here rather than a record of zeroes: absent is
     * "nothing was wired", never "the op did none of it" (43.19). Read a source through
     * `publishedBy`, which throws naming a field the record lacks (43.20).
     */
    published: PublishedWork
}
