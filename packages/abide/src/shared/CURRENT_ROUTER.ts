// THE ROUTER THIS DOCUMENT HAS, or null. 30.7's `navigate` takes a URL and nothing else, so the
// router it drives cannot be an argument — and a document has exactly one, which is what makes a
// single slot the honest shape rather than a registry keyed on something.
//
// A LEAF, and that is what keeps `#ui` out of `#shared`'s graph: the client router WRITES this on
// start and `navigate` READS it, so the app-facing name resolves through the shared seam while the
// implementation stays on the side that has a document. On a server it is null and `navigate`
// says so.
// Named for what it DOES rather than what it is: `Navigator` is a DOM global, and a routing file
// is the one place a reader would take the two for each other.
export type Navigable = {
    go(url: URL | string, options: NavigateOptions): Promise<void>
}

export type NavigateOptions = { replace?: boolean; keepScroll?: boolean }

export const CURRENT_ROUTER: { current: Navigable | null } = { current: null }
