import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'

/*
Runs `fn` with dependency tracking suspended: reads inside register no
subscription on the surrounding observer. The inverse of `track` — for a
reactive computation that must read or build without capturing those reads as
its own dependencies. The router mounts a page inside an effect, so without this
the page's build-time reads (every interpolation reads its value once before
wrapping it in its own effect) would subscribe the router effect to the page's
state — any in-page change would then re-run the router and re-mount the page.
*/
export function untrack<T>(fn: () => T): T {
    const previous = REACTIVE_CONTEXT.observer
    REACTIVE_CONTEXT.observer = undefined
    try {
        return fn()
    } finally {
        REACTIVE_CONTEXT.observer = previous
    }
}
