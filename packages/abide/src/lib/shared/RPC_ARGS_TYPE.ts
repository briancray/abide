/*
The `RpcArgs<Fn>` type alias both rpc d.ts writers emit verbatim: it lifts the
args type out of a RemoteFunction, dropping the FormData upload variant so a
url()/test-client call types against the rpc's plain args.
*/
export const RPC_ARGS_TYPE =
    'type RpcArgs<Fn> = Fn extends (args: infer Args) => unknown ? Exclude<Args, FormData> : never'
