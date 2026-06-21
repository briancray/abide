/* The compile-time AST tag a layout's `<slot/>` is rewritten to (`asOutlet`). It is a
   sentinel only — never a rendered element: both compiler back-ends lower it to an empty
   `<!--abide:outlet-->`…`<!--/abide:outlet-->` comment boundary (`outlet` on the client,
   the marker string in SSR) the router fills with the next chain layer. Shared by both
   back-ends and `skeletonContext` so they all agree which node is the outlet. */
// @documentation plumbing
export const OUTLET_TAG = 'abide-outlet'
