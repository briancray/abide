// Global `invalidate({ tags })` — the ONLY global cache-verb form (per-callable `fn.invalidate` is
// canonical for args). Drops every SHARED slot carrying any listed tag back to idle (lazy reload on
// next read) and broadcasts to affected subscribers (rpc-core §8, shared-cache-plan §2.4).
//
// Server concept: the tag registry is populated only by shared cells (server-only). On the client
// the registry is empty, so this is inert there (client bare-tag subscription is deferred).

import { invalidateTags } from '../server/internal/cacheTags.ts'

export function invalidate(selector: { tags: string[] }): void {
    invalidateTags(selector.tags)
}
