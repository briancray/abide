// Global `refresh({ tags })` — the ONLY global cache-verb form (per-callable `fn.refresh` is
// canonical for args). Eagerly revalidates every SHARED slot carrying any listed tag (stale value
// retained while refreshing) and broadcasts to affected subscribers (rpc-core §8, §2.4).
//
// Server concept: inert on the client (the tag registry is populated only by server shared cells).

import { refreshTags } from "../server/internal/cacheTags.ts";

export function refresh(selector: { tags: string[] }): void {
  refreshTags(selector.tags);
}
