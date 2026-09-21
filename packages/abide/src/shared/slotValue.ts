// 32.24 — A TEMPLATE EXPRESSION A `NotLanded` ABORTED LEAVES WHAT IT LAST RENDERED, which on a
// server's first render of a page is nothing. 41.4 is the other half and the one that makes this
// a module rather than a line: a render MUST continue past a value still in flight, so the slot
// is what aborts and never the document.
//
// A THUNK, BECAUSE THE READ IS THE BODY. On the client every binding is already its own `watch`,
// so 2.13 gives each slot an abortable body for free and a `NotLanded` takes down exactly the one
// that read it. The server has no such body — `emitComponent` builds the markup as ONE
// concatenation — so the first unlanded read threw out of `Component()` and `render` died on its
// first `next()`, losing the static markup, every other slot and the `<head>` with them. Passing
// the read rather than its result is what gives the slot the body the client's binding already
// has, and it is one closure per guarded position per render.
//
// ONLY THE READ IS INSIDE THE TRY, and the escaping stays OUTSIDE it. Escaping cannot throw a
// `NotLanded`, and a guard wide enough to cover it would catch one from somewhere that is not the
// expression — which is the one thing a brand is for. It is also what lets every markup position
// share this: the value's absence is `undefined` here, and what `undefined` MEANS is already
// decided where it lands. `escapeText`, `escapeAttribute` and `escapeStyleValue` all read it as
// '' through `textOf`, `listOf` reads it as absent and iterates zero times (32.23), and an `{#if}`
// subject reads it as false. One abort, five positions, no fallback decided twice.

import { NotLanded } from './reactive/NotLanded.ts'

export function slotValue(read: () => unknown): unknown {
    try {
        return read()
    } catch (thrown) {
        // 2.15 — a `NotLanded` and a `Failed` are distinguishable by brand, and only the first is
        // "not yet". A producer that FAILED is 2.2's throw and belongs to whoever is rendering.
        if (thrown instanceof NotLanded) return undefined
        throw thrown
    }
}
