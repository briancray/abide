// Client-safe cache-channel naming (shared-cache-plan §2.2 / §2.5). The deterministic name for a
// `(rpc,args)` invalidation channel is pure over `(rpcName, canonicalKey(args))`, so it is factored
// here — importable from BOTH the server broadcast registry (`server/internal/cacheChannels.ts`) and
// the browser mux (`ui/internal/cacheMux.ts`) WITHOUT dragging any server-only transport (SocketHub)
// into the client bundle. The server and the client MUST compute the identical name so an auto-
// subscribing browser cell joins exactly the channel the server publishes on.

import { canonicalKey } from "./codec.ts";

// Reserved `@rpc:` namespace keeps a cache channel distinct from a bare user-socket name (which
// never carries `@`/`:`). Kept in lockstep with the server prefix in cacheChannels.ts / channelAuth.ts.
const RPC_CHANNEL_PREFIX = "@rpc:";

// Deterministic channel name for a `(rpc,args)` pair. Stable for canonically-equal args, distinct
// for different args or a different rpc.
export function cacheChannelName(rpcName: string, args: unknown): string {
  return RPC_CHANNEL_PREFIX + rpcName + ":" + canonicalKey(args);
}
