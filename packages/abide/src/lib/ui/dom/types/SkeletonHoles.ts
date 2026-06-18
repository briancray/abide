/* The holes a realized `skeleton` exposes for the build's attach code to wire up:
   `el` the element holes (attribute/listener/bind nodes) in pre-order, `an` the anchor
   holes (reactive text, control flow, components) in document order. Two arrays so the
   compiler and SSR only agree on traversal order, never on synchronized indices. */
export type SkeletonHoles = {
    el: Element[]
    an: Node[]
}
