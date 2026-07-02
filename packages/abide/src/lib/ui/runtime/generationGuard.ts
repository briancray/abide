import { OWNER } from './OWNER.ts'

/*
A monotonic generation an async block checks before a late continuation touches the DOM. It
answers one question — "is the work I started still the current work?" — and is bumped on the
two events that both invalidate in-flight work: a reactive `renew()` (a re-run supersedes the
prior promise/drain) and the enclosing OWNER's teardown (a settle after disposal must be
DROPPED, not run `place`/`insertBefore` on a now-detached anchor → NotFoundError). `onTeardown`
releases extra resources at teardown (e.g. an async iterator's `return()`).

Extracted from the byte-identical guard hand-rolled in `awaitBlock` and `eachAsync`. The
teardown half is the load-bearing one: a re-run bump alone leaves a promise/drain that settles
AFTER disposal to still pass the liveness check and crash on the dead anchor — the bug both
sites independently had to grow.
*/
export function generationGuard(onTeardown?: () => void): {
    renew: () => number
    token: () => number
    live: (captured: number) => boolean
} {
    let generation = 0
    /* The teardown bump is load-bearing: without it a promise/drain settling after the owner
       disposes still passes `live(captured)` and touches a detached anchor. */
    if (OWNER.current !== undefined) {
        OWNER.current.push(() => {
            generation += 1
            onTeardown?.()
        })
    }
    return {
        /* Supersede any in-flight generation; call at the start of each (re-)run. Returns the
           new token so a runner can capture it in the same statement. */
        renew: () => (generation += 1),
        /* The live generation to capture before an await and compare after — for when the
           renew and the capture happen in different functions (as in awaitBlock's render). */
        token: () => generation,
        /* Whether `captured` is still the live generation — safe to touch the DOM. */
        live: (captured: number) => captured === generation,
    }
}
