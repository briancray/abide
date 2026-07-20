// PATCH — mutating RPC helper, identical semantics to POST (no cache, direct call).

import { makeMutation, type Mutation, type Payload, type RpcOptions } from "./internal/makeRpc.ts";

export function PATCH<Args, R>(fn: (args: Args) => Promise<R> | R, opts?: RpcOptions): Mutation<Args, Payload<R>> {
  return makeMutation<Args, R>("PATCH", fn, opts);
}
