// Apply an inbound cache-broadcast frame to a LOCAL client cell (shared-cache-plan §2.5). The
// browser holds no new cache logic for shared reads — a `CacheFrame` off the `(rpc,args)` channel
// just drives the cell's EXISTING verbs, keyed by the args the client subscribed with:
//   invalidate → cell.invalidate(args)  (lazy reload on next read)
//   refresh    → cell.refresh(args)     (eager revalidation)
//   amend      → cell.amend(args, value) (value-form; the server resolved any updater to a value)
//
// Factored out of the mux/proxy wiring so the mapping is unit-testable against a real client cell
// without a live WebSocket.

import type { Cell } from "../../shared/cell.ts";
import type { CacheFrame } from "../../server/internal/cacheChannels.ts";

export function applyCacheFrame<Args, T>(cell: Cell<Args, T>, args: Args, frame: CacheFrame): void {
  if (frame.verb === "invalidate") cell.invalidate(args);
  else if (frame.verb === "refresh") cell.refresh(args);
  else if (frame.verb === "amend") cell.amend(args, frame.value as T);
}
