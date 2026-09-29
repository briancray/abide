import { RAW_CLOSE, RAW_OPEN } from './RAW_RUN.ts'

/**
 * The brand `raw` hands back: markup a slot writes unescaped.
 *
 * 32.25 — the value `raw` hands back, and the brand a slot reads to know not to escape it. In
 * #shared because both sides render: the server writes the markup and a client swapping a `{#if}`
 * branch re-renders that region, so one brand has to be readable from both.
 *
 * A CLASS RATHER THAN A TAGGED RECORD, for what the READ costs. `value instanceof Raw` lands on
 * the per-slot escape path, and for the string or number every other slot carries it is rejected
 * on the operand's type before any prototype is walked — one branch, no property load. A probe
 * (`value.__raw === true`) is a dynamic property access on that same path, which is what
 * CLAUDE.md's hot-path rule refuses; a `Symbol` key is the same access spelled differently, and
 * it is also megamorphic here, the slot seeing a different hidden class on every row.
 *
 * WHAT IT COSTS IS UNDER THE NOISE FLOOR, and that is measured rather than asserted: two arms of
 * `escapeText` differing only in this line, 200,000 calls a sample on a clean 46-character slot,
 * reported 1.13x then 0.90x over two runs of one process and 1.13x then 0.93x over a second
 * process. THE ARMS SWAP PLACES, which is the answer — the whole call is ~15 ns and the same arm
 * moves 8% between its own runs.
 *
 * STRINGIFIED AT THE BRAND rather than at the slot, so the escape path's fast return is one
 * field read and the shape is fixed at construction.
 */
export class Raw {
    html: string

    constructor(html: string) {
        this.html = html
    }
}

/**
 * A slot value as text: a `Raw`'s html, and nothing for an absent value.
 *
 * `String(value)` on a `Raw` is `[object Object]`.
 */
export function textOf(value: unknown): string {
    if (value instanceof Raw) return value.html
    return value == null ? '' : String(value)
}

/**
 * Brands a value's text as markup to render unescaped.
 *
 * 32.2, 32.26 — the one mechanism. `{raw(x)}` lowers to this call and an imported `raw` IS this
 * call, so a value branded in a `<script>` and a value branded in a slot are the same object.
 */
export function raw(value: unknown): Raw {
    return new Raw(textOf(value))
}

/**
 * Whether a value is the brand.
 *
 * For the places that have to ask rather than just read it: a run the browser builds or binds is
 * a text node unless one of its values is `Raw` (`emitClient`).
 */
export function isRaw(value: unknown): value is Raw {
    return value instanceof Raw
}

/**
 * How many `Raw` parts the text escaper has ever written.
 *
 * The one thing a run's markup cannot say about itself once it is a string. `escapeText` counts a
 * `Raw` as it hands its html back, so a run read the count before its parts were escaped and
 * compares after: moved means a part was markup, and the run is anchored (`markupRun`). A counter
 * rather than a flag because a flag has to be reset, and a reset inside a part's own evaluation
 * would hide the part before it.
 *
 * NEVER RESET, and what that lets through is stated: a part whose EVALUATION escaped a `Raw` it did
 * not return anchors a run that holds text. The client reads that as a run holding markup whose
 * value is text, and its first write puts the text node back — one node, never a wrong page.
 */
export const RAW_WRITES = { count: 0 }

/**
 * A run's markup, wrapped in the `RAW_RUN` anchors when a `Raw` part was written since `before`.
 *
 * 32.31 — A RUN HOLDING MARKUP IS ANCHORED, and one holding text is written as it always was. What
 * the server writes and what a browser parses for a row or an arm, so the walk that finds a run
 * (`runHere`) reads the same thing either way.
 */
export function markupRun(before: number, markup: string): string {
    return RAW_WRITES.count === before
        ? markup
        : `<!--${RAW_OPEN}-->${markup}<!--${RAW_CLOSE}-->`
}
