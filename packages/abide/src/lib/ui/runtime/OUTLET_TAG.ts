/* The element a layout's `<slot/>` lowers to: an empty structural container the
   router fills with the next layer of the route's layout chain (the nested layout
   or the page). SSR emits it empty so the renderer can fold the child's html into
   it; on the client the router mounts/hydrates the child into it and finds it by
   tag. Shared by both compiler back-ends, the SSR chain composer, and the router so
   they all agree on the marker. */
// @readme plumbing
export const OUTLET_TAG = 'abide-outlet'
