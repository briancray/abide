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
