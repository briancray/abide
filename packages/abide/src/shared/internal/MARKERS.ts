// The marker contract — the one thing a rendering server and a hydrating client must agree on, so it
// is written down ONCE and imported by both rather than hand-maintained in two files.
//
// Only CHILD slots carry markers. An element holding an attribute/event/property/ref slot needs none:
// the prepared template and the live document agree on it POSITIONALLY, so the adopt walk finds it by
// structure. A child slot is the opposite — its content is a value, absent from the template, and the
// HTML parser will happily merge the three pieces of `<p>a${x}b</p>` into one text node. An anonymous
// OPEN before the content and the slot's own anchor after it are what make the boundary recoverable.
//
// The markers NEST, which is what lets a scan find the right close: a nested template's own pairs are
// balanced, so counting depth from an open to the matching close cannot be fooled by a nested slot
// sitting at the same sibling level.

/** The anonymous opening marker's comment data. */
export const SLOT_OPEN = '['

export const OPEN_MARKER = `<!--${SLOT_OPEN}-->`

/**
 * The sigil a close marker's data opens with.
 *
 * Exported because three places ask "is this comment one of ours?" by testing this one character —
 * `prepare`'s `opensWithSlot` and its record walk, and the adopt walk in `parts.ts` — and they test
 * it rather than `CLOSE_FORM` on purpose: they are the LOOSER question, since an author's own
 * `<!--$foo-->` reaching the template has to be recognised as not-content before anything reads a
 * slot number out of it. Deriving them all from here is what makes the sigil changeable; spelled
 * per site, changing it left the server emitting one form and three readers looking for another,
 * with no compile error and no failing test.
 */
export const SLOT_CLOSE = '$'

/** `SLOT_CLOSE`'s code unit, for the per-node walk in `prepare` that reads it once per comment. */
export const SLOT_CLOSE_CODE = SLOT_CLOSE.charCodeAt(0)

/**
 * A close marker's comment DATA on its own — what the adopt walk compares a found comment against,
 * and the half `prepare` and the server both build their markup from. Split out for the reason
 * `SLOT_OPEN`/`OPEN_MARKER` are: the data and the markup are one fact, so neither is spelled twice.
 */
export function closeData(slot: number): string {
    return `${SLOT_CLOSE}${slot}`
}

/** The close marker IS the anchor `prepare` already puts in the client's template, verbatim. */
export function closeMarker(slot: number): string {
    return `<!--${closeData(slot)}-->`
}

/**
 * What a close marker's comment data looks like, for the depth scan — the STRICT form, where the
 * three `SLOT_CLOSE` tests are the loose one. A regex literal cannot interpolate, so this is the one
 * place the sigil is written twice; changing `SLOT_CLOSE` means changing this too.
 */
export const CLOSE_FORM = /^\$\d+$/

// --- streaming a fragment ------------------------------------------------------
//
// A document streams to the browser's OWN parser, which consumes bytes as they arrive and runs the
// two-line `$p` script the moment it is parsed. A navigation has neither: the client is holding a
// byte stream and doing the parsing itself, and a `<script>` it injects will not run at all — the
// HTML spec makes script elements inserted this way non-executable, so the document's patch protocol
// cannot simply be pointed at a fragment.
//
// What a client-side parser needs instead is to know where a PIECE ends, because HTML cannot be
// parsed halfway: there is no browser API that feeds a partial tree, so the only safe unit is a run
// of markup that is complete on its own. The walk already produces exactly those — the in-order pass
// is one, and each deferred subtree is another — so the framing is a sentinel after each.
//
// A COMMENT, because it has to survive being concatenated into markup and then not be there: the
// client cuts on it and never parses it, and if one ever did reach a parser it is inert.

/** Written after every complete piece of a streamed fragment. The client cuts on it. */
export const PIECE_END = '<!--abide:piece-->'

// --- what a deferred subtree leaves behind, and what replaces it -----------------
//
// Two ids for one subtree: the PLACEHOLDER the walk writes where the subtree will go, and the PATCH
// carrying the markup that lands there. A document swaps them with the two-line `$p` script; a
// navigation swaps them from `ui/internal/navigation.ts`. Three writers and two readers of the same
// two strings, so the prefixes are here and everything else is derived from them — a rename that
// reaches only some of them breaks a navigation silently, because a patch that finds no placeholder
// only warns.

const PLACEHOLDER_PREFIX = 's'

const PATCH_PREFIX = 't'

/** The element a deferred subtree stands behind until it arrives, by id. */
export function placeholderId(id: number): string {
    return `${PLACEHOLDER_PREFIX}${id}`
}

export const PLACEHOLDER_TAG = 'slot-s'

/** The `<template>` carrying one settled subtree, by the id of the placeholder it replaces. */
export function patchId(id: number): string {
    return `${PATCH_PREFIX}${id}`
}

/** What a patch id looks like to the client reading it back off the wire. */
export const PATCH_FORM = new RegExp(`^${PATCH_PREFIX}(\\d+)$`)

/**
 * The same swap as a JS expression, for the inline script a DOCUMENT patches with.
 *
 * A string rather than a call because it runs in the browser with nothing imported — but the halves
 * it is built from are the same ones the server writes with.
 */
export const PATCH_SWAP =
    `var t=document.getElementById(${JSON.stringify(PATCH_PREFIX)}+i),` +
    `s=document.getElementById(${JSON.stringify(PLACEHOLDER_PREFIX)}+i)`
