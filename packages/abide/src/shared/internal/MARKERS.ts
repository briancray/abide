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

/** The close marker IS the anchor `prepare` already puts in the client's template, verbatim. */
export function closeMarker(slot: number): string {
    return `<!--$${slot}-->`
}

/** What a close marker's comment data looks like, for the depth scan. */
export const CLOSE_FORM = /^\$\d+$/
