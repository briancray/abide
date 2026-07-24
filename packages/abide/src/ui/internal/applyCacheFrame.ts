// Apply an inbound cache-broadcast frame to a LOCAL client memo (shared-cache-plan §2.5). The
// browser holds no new cache logic for shared reads — a `CacheFrame` off the `(rpc,args)` channel
// just drives the memo's EXISTING verbs, keyed by the args the client subscribed with:
//   invalidate → memo.invalidate(args)  (lazy reload on next read)
//   refresh    → memo.refresh(args)     (eager revalidation)
//   publish      → memo.publish(args, value) (value-form; the server resolved any updater to a value)
//
// Factored out of the mux/proxy wiring so the mapping is unit-testable against a real client memo
// without a live WebSocket.

import type { CacheFrame } from '../../server/internal/cacheChannels.ts'
import type { Memo } from '../../shared/memo.ts'

export function applyCacheFrame<Args, T>(memo: Memo<Args, T>, args: Args, frame: CacheFrame): void {
    if (frame.verb === 'invalidate') memo.invalidate(args)
    else if (frame.verb === 'refresh') memo.refresh(args)
    else if (frame.verb === 'publish') memo.publish(args, frame.value as T)
}
