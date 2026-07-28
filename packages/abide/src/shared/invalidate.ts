// Global `invalidate({ tags })` — the ONLY global cache-verb form (per-callable `fn.invalidate` is
// canonical for args). Drops every SHARED slot carrying any listed tag back to idle (lazy reload on
// next read) and broadcasts to affected subscribers (rpc-core §8, shared-cache-plan §2.4).
//
// ISOMORPHIC, not server-only. The tag registry lives in `shared/internal/memoTags.ts` and depends
// on nothing above `shared/`; a browser memo registers its tags too. This file used to say the
// opposite — that the client registry is empty and the call is inert there — which was true only
// while tags were gated on `crossRequest` (a browser memo is never `crossRequest`, so tags went in
// and nothing came out). That gate is gone: a client-side `invalidate({ tags })` re-runs every live
// slot of every rpc carrying the tag, and a SERVER-side one reaches browsers over the reserved
// `@tag:<tag>` mux channel.

import { invalidateTags } from './internal/memoTags.ts'

export function invalidate(selector: { tags: string[] }): void {
    invalidateTags(selector.tags)
}
