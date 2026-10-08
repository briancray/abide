import type { Read } from './classifyRead.ts'
import type { Span } from './projectShadow.ts'

/**
 * What the checker answered about one `.abide`: its reads, and the template positions it proved.
 *
 * TWO ANSWERS, KEPT APART. A READ is an occurrence the splice rewrites (`Lowering`); a PROOF is
 * about a whole position — 14.2's "reads nothing reactive" (`proveSlots`) — and rewrites nothing.
 * Both are offsets into the file's projection (`projectShadow`), so an answer holds for any parse
 * of the same source, and every question about a span is asked here rather than re-scanned by
 * each reader.
 */
export class CheckerAnswer {
    /** Ascending by `start`, so a span with none in it is one binary search. */
    readonly reads: readonly Read[]
    /** 14.2 — the start of every template position the checker proved reads nothing reactive. */
    private readonly statics: ReadonlySet<number>

    constructor(reads: readonly Read[], statics: ReadonlySet<number>) {
        this.reads = reads
        this.statics = statics
    }

    /**
     * Whether the checker proved the position at `span` static.
     *
     * ABSENCE IS LIVE: a file lowered with no checker binds every position, which is the safe side
     * of a question nobody asked.
     */
    isStatic(span: Span): boolean {
        return this.statics.has(span.start)
    }

    /** Whether a read starts inside `span` — one `matches`, where given. */
    holdsRead(span: Span, matches?: (read: Read) => boolean): boolean {
        for (
            let at = this.firstRead(span.start);
            at < this.reads.length;
            at += 1
        ) {
            const read = this.reads[at] as Read
            if (read.start >= span.end) return false
            if (matches === undefined || matches(read)) return true
        }
        return false
    }

    /** The index of the first read starting at or after `offset`. */
    firstRead(offset: number): number {
        let low = 0
        let high = this.reads.length
        while (low < high) {
            const middle = (low + high) >>> 1
            if ((this.reads[middle] as Read).start < offset) low = middle + 1
            else high = middle
        }
        return low
    }
}

/** The answer where no checker was asked: no reads, and no position proven. */
export const UNCHECKED = new CheckerAnswer([], new Set())
