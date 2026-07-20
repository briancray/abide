// Global `pending({ tags })` — LOCAL reactive aggregate: true if ANY shared slot carrying a listed
// tag is on its first load (rpc-core §8, shared-cache-plan §2.4). No broadcast. Reading it in a
// tracking context subscribes to every selected slot signal.

import { pendingTags } from "../server/internal/cacheTags.ts";

export function pending(selector: { tags: string[] }): boolean {
  return pendingTags(selector.tags);
}
