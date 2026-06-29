/* The holes a realized `skeleton` exposes for the build's attach code to wire up:
   `el` the element holes (attribute/listener/bind nodes) in pre-order, `an` the anchor
   holes (reactive text, control flow, components) in document order. Two arrays because
   the element and anchor walks follow different traversal rules (`walkElementOrder` vs
   `walkAnchorOrder`), so their indices are independent series — el[N] and an[N] are
   unrelated holes, each numbered from 0 by its own walk. */
export type SkeletonHoles = {
    el: Element[]
    an: Node[]
}
