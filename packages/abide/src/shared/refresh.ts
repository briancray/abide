// Global `refresh({ tags })` — the ONLY global cache-verb form (per-callable `fn.refresh` is
// canonical for args). Eagerly revalidates every SHARED slot carrying any listed tag (stale value
// retained while refreshing) and broadcasts to affected subscribers (rpc-core §8, §2.4).
//
// ISOMORPHIC, not server-only — see [[invalidate]] for why this file used to claim otherwise. A
// browser memo registers its tags, so a client-side `refresh({ tags })` revalidates them, and a
// server-side one reaches browsers over the reserved `@tag:<tag>` mux channel (the frame carries a
// verb and NO payload; the client re-reads over HTTP under its own identity).

import { refreshTags } from './internal/memoTags.ts'

export function refresh(selector: { tags: string[] }): void {
    refreshTags(selector.tags)
}
