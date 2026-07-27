// Stamped on the app container (`#__abide-app`) the moment a page's listeners are attached, and removed
// when the page is disposed for good.
//
// An SSR'd page is VISIBLE before it is INTERACTIVE: `bootstrapApp` awaits the route's code-split chunk,
// so between `load` and hydration the server's HTML is on screen with nothing wired to it. A click in
// that window hits a button with no handler and is simply lost. This attribute is the observable line
// between the two states — for a browser test that must not act early, and for anyone staring at a
// rendered page wondering why it does nothing.
export const HYDRATED_ATTRIBUTE = 'data-abide-hydrated'
