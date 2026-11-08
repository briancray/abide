// 22.11 — WHICH SIDE THE WORK RUNNING IS ON, read where it runs rather than fixed at build or load.
//
// NOT `typeof document`: a test process preloads a DOM and runs both halves of a page through one
// instance of every module — `App.fetch` and `mount`'s render are a server's, `mount`'s hydration a
// browser's — so the globals are the same on both sides and a build-time constant is one answer for
// two. What tells them apart is what the server alone enters: a request scope, or a render (the
// provider's `serving`). A process with no document at all is a server whatever it is doing.

import { SCOPING } from './reactive/scoping.ts'

/** Whether the work running is a server's. */
export function isServer(): boolean {
    if (typeof document === 'undefined') return true
    const provider = SCOPING.provider
    return provider !== null && provider.serving()
}
