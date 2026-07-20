// Global `refreshing({ tags })` — LOCAL reactive aggregate: true if ANY shared slot carrying a
// listed tag is revalidating over a retained value (rpc-core §8, §2.4). No broadcast. Reading it in
// a tracking context subscribes to every selected slot signal.

import { refreshingTags } from '../server/internal/cacheTags.ts'

export function refreshing(selector: { tags: string[] }): boolean {
    return refreshingTags(selector.tags)
}
