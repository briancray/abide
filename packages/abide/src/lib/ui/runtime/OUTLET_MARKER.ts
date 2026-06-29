/* The comment-marker boundary a layout's `<slot/>` outlet lowers to — replacing the old
   `<abide-outlet>` ELEMENT, so the next chain layer the router fills in lays out as a true
   direct child of the slot's parent (no wrapper box breaking the layout's flex/grid/`:first-child`).

   `abide:outlet` / `/abide:outlet` deliberately match `markerDepthDelta`'s `startsWith('abide:')` /
   `startsWith('/abide:')` rule (the `abide:` / `/abide:` convention), so a layout's own hole-scanning treats the outlet's
   future child content as a balanced range and skips it — exactly like an `await`/`try` boundary.
   The router fills the boundary with the next layer (see `outlet`/`fillBoundary`). */
export const OUTLET_OPEN = 'abide:outlet'
export const OUTLET_CLOSE = '/abide:outlet'
