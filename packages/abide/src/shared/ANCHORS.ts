// The comment anchors — the ONE thing a compiled document carries that an authored one does not,
// spelled two ways: a dynamic region's pair, and a text run's pair while it holds a `Raw` value
// (32.30), kept apart from the region's by 32.31. The server and the compiler write them through
// `anchorMarkup.ts`, and `markupRun` spells its own because it runs in the browser too; the client
// reads them as comment data.
//
// WHY ANYTHING AT ALL, when a static region needs nothing: a region's content length depends on a
// value, so every sibling after it moves. Child-index addressing cannot survive that, and the
// anchors are what the siblings after a region are counted from instead.
//
// WHY A COMMENT. `invariance.spec.ts` measures it: a comment is not an element, so it joins no
// combinator chain and changes nothing about descendant, `:has`, `+`, `~`, `:nth-child` or
// `:empty` matching. A wrapper element breaks all of those; an attribute is matched by a selector
// the author wrote. A comment is the only structure a compiler may add, and it adds one for each
// pair here, for the same reason: markup whose length depends on a value.
//
// 41.24 — A REGION THE SERVER PAINTED AN ARM OF CARRIES THE ARM after the open (`armAnchor.ts`).
// Only the server writes it: a region the browser fills is adopted in the same turn its arm was
// chosen, so the two cannot disagree. Every comment whose data starts with `REGION_OPEN` opens a
// region, a named one included (`opensRegion`).
export const REGION_OPEN = '['
export const REGION_CLOSE = ']'

/**
 * A row's opening anchor, emitted only where a row's body has more than one top-level node.
 *
 * A single-element row IS its element — the nodes between the region's anchors are the rows and
 * nothing has to be added to tell them apart — but `<dt>{k}</dt><dd>{v}</dd>` has no such node,
 * and counting elements there finds four rows in a list of two.
 *
 * One comment per ROW, not per slot, which is the difference between ~2.5 bytes gzipped a row and
 * the doubled page `benchGrid.ts` measured for per-slot markers.
 */
export const ROW_OPEN = 'r'

/**
 * The comment anchor opening a text run while it holds markup.
 *
 * 32.30 — the comment anchors a text run is delimited by WHILE IT HOLDS MARKUP (32.26), and
 * nothing else in a document carries them. A run is one text node while its value is text; a
 * `Raw` part parses into any number of nodes, so every sibling after it is found from the closing
 * anchor instead — the way a region's siblings are found from `REGION_CLOSE`.
 *
 * 32.31 — NOT THE REGION PAIR. A blank run the server rendered as nothing stands where the next
 * region's `REGION_OPEN` is, so a run that read a region's anchor as its own would take the
 * region's content for its markup. And a run's anchors never nest: what stands between them is the
 * author's markup.
 *
 * ONLY WHILE A PART IS `Raw`, so a run holding text — every slot whose value was never branded —
 * is one text node and costs nothing in the document.
 */
export const RAW_OPEN = '{'
/** The comment anchor closing a text run while it holds markup; see `RAW_OPEN`. */
export const RAW_CLOSE = '}'
