// GET — read-only RPC helper (rpc-core §4). The handler is wrapped in a cell so in-process
// calls cache, coalesce, and are reactive; the router mounts it at `/rpc/<name>` via `__rpc`.

import { makeRead, type ReadSurface, type Rpc, type RpcOptions } from "./internal/makeRpc.ts";

export type { Rpc, RpcOptions } from "./internal/makeRpc.ts";
export type { StreamRead } from "./internal/makeRpc.ts";

// The return type is conditional: a handler yielding an `AsyncIterable<C>` gets a `StreamRead<Args, C>`
// (reactive `latest`/`chunks`/`done`); a value handler gets the usual `Rpc<Args, T>`.
export function GET<Args, R>(fn: (args: Args) => Promise<R> | R, opts?: RpcOptions): ReadSurface<Args, R> {
  return makeRead<Args, R>("GET", fn, opts) as unknown as ReadSurface<Args, R>;
}
