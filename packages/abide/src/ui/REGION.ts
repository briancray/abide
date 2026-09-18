// The comment anchors a dynamic region is delimited by, and the ONLY thing a compiled document
// carries that an authored one does not.
//
// WHY ANYTHING AT ALL, when a static region needs nothing: a region's content length depends on a
// value, so every sibling after it moves. Child-index addressing cannot survive that, and the
// anchors are what the siblings after a region are counted from instead.
//
// WHY A COMMENT. `invariance.spec.ts` measures it: a comment is not an element, so it joins no
// combinator chain and changes nothing about descendant, `:has`, `+`, `~`, `:nth-child` or
// `:empty` matching. A wrapper element breaks all of those; an attribute is matched by a selector
// the author wrote. A comment is the only structure a compiler may add, and this is the only
// place it adds one.
export const REGION_OPEN = '['
export const REGION_CLOSE = ']'

// A ROW's opening anchor, emitted ONLY where a row's body has more than one top-level node. A
// single-element row IS its element — the nodes between the region's anchors are the rows and
// nothing has to be added to tell them apart — but `<dt>{k}</dt><dd>{v}</dd>` has no such node,
// and counting elements there finds four rows in a list of two.
//
// One comment per ROW, not per slot, which is the difference between ~2.5 bytes gzipped a row and
// the doubled page `benchGrid.ts` measured for per-slot markers.
export const ROW_OPEN = 'r'
