import type { RpcOptions } from './RpcOptions.ts'

/*
Call signature shared by RemoteFunction and RawRemoteFunction. The base
signature keeps `args` required so a schema'd rpc can't silently drop its
input; when `Args` admits undefined (no-input rpcs) an intersected
optional-arg signature lets call sites write `fn()` instead of
`fn(undefined)`. Intersection rather than a bare conditional so the type
stays callable while `Args` is still generic (cache() invokes producers
before `Args` resolves). FormData is the multipart upload escape hatch —
see RemoteFunction. The optional trailing `opts` carries per-call transport
options (signal/keepalive/priority/cache/headers); the server ignores them,
so the callable stays isomorphic.
*/
export type RemoteCallable<Args, Resolved> = ((
    args: Args | FormData,
    opts?: RpcOptions,
) => Promise<Resolved>) &
    (undefined extends Args
        ? (args?: Args | FormData, opts?: RpcOptions) => Promise<Resolved>
        : unknown)
