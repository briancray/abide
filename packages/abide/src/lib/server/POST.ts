// POST — mutating RPC helper (rpc-core §4). Routes through a cell defaulting to `cache: { ttl: 0 }`
// (replayable-streams.md §1): coalesce identical CONCURRENT in-flight calls (per-request scope, so
// inert for the normal one-call-per-request case), retain nothing. `cache: false` opts out entirely; a
// FormData body always bypasses the cell. Exposes only the call and `__rpc`; mounted at `/rpc/<name>`.

import { makeMutation, type Mutation, type Payload, type RpcOptions } from "./internal/makeRpc.ts";

// The resolved type unwraps a transport wrapper (`json(x)` → `x`, `jsonl(gen())` → the stream), so a
// mutation behaves the same whether the handler returns its result raw or wrapped (replayable-streams §4).
export function POST<Args, R>(fn: (args: Args) => Promise<R> | R, opts?: RpcOptions): Mutation<Args, Payload<R>> {
  return makeMutation<Args, R>("POST", fn, opts);
}
