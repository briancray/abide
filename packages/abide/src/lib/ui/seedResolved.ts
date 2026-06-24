import { RESUME } from './runtime/RESUME.ts'
import { seedStreamedResolution } from './seedStreamedResolution.ts'
import type { ResolvedFrame } from './types/ResolvedFrame.ts'

/*
The single client intake seam for SSR warm-state seeding. Both warm-seed channels —
the cache-snapshot channel (a settled `cache()` value, keyed by cache key) and the
await-resume channel (an `await`-block resolved value, keyed by boundary id) — answer
the same "ship a server-settled value so hydration doesn't re-fetch" question, but land
in two distinct stores: the cache STORE (read by `cache()`) and the RESUME MANIFEST
(read by `awaitBlock` on adopt). This routes a discriminated `ResolvedFrame` to the
matching store so every consumer — startClient's boot drain, the live `__abideResolve`,
applyResolved's stream swap — registers through ONE call instead of poking each store
inline. The codecs stay split by source: the cache value is an HTTP body capped at plain
JSON (it must agree with the live `decodeResponse` read), the resume value is an in-process
graph carried as ref-json text and decoded lazily at the read site.
*/
// @documentation plumbing
export function seedResolved(frame: ResolvedFrame): void {
    if (frame.kind === 'cache') {
        seedStreamedResolution(frame.resolution)
        return
    }
    /* The resume value rides as raw ref-json text; store it unparsed so the inline
       stream-swap script (vanilla, runs before the bundle's codec loads) can register
       through this same seam. `awaitBlock` decodes it at the read. */
    RESUME[frame.id] = frame.resume
}
