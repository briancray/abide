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
