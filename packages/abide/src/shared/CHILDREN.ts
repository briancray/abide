/**
 * The prop name a caller's between-the-tags content is passed under.
 *
 * 33.16 — `children` is always accepted and never declared, so a component reads it through
 * `<slot/>` (32.18) rather than through `props<T>()`.
 *
 * A LEAF, because the two lanes have to agree about it exactly: the server emitter puts a markup
 * thunk under this name and the child's `<slot/>` reads it back, and the client emitter puts the
 * markup-and-mount pair under it for the same position to read.
 */
export const CHILDREN = 'children'
