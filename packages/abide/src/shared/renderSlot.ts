// 32.25 — A TEMPLATE EXPRESSION A `NotLanded` ABORTED LEAVES WHAT IT LAST RENDERED, which on a
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
// has, and it is one closure per dynamic slot per render.
//
// ONLY THE READ IS INSIDE THE TRY. Escaping cannot throw this and wrapping it too would catch a
// `NotLanded` from somewhere that is not the expression, which is the one thing a brand is for.

import { escapeText } from './escapeText.ts'
import { NotLanded } from './reactive/NotLanded.ts'

// WHAT THE EXPRESSION ANSWERED, or `undefined` where it has not landed. The two positions that
// need this want DIFFERENT absences and neither wants a string: a `{#for}` subject that is absent
// iterates zero times (32.24, and `listOf` already answers `[]` for it), where a text slot renders
// empty. One abort, two fallbacks, and the fallback stays where it is already decided.
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

// `escapeText` reads `undefined` as '' already, so the abort and an expression that genuinely
// answered nothing render the same — which they should.
export function renderSlot(read: () => unknown): string {
    return escapeText(slotValue(read))
}
