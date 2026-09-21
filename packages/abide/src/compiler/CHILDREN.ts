// 33.16 — WHAT A CALLER PASSES BETWEEN THE TAGS, under the one name the registry gives it:
// `children` is always accepted and never declared, so a component reads it through `<slot/>`
// (32.19) rather than through `props<T>()`.
//
// A LEAF, because the two lanes have to agree about it exactly: the server emitter puts a markup
// thunk under this name and the child's `<slot/>` reads it back, and the client emitter puts the
// markup-and-mount pair under it for the same position to read.
export const CHILDREN = 'children'
