import type { RpcOptions } from './RpcOptions.ts'
import type { NamedAsyncIterable } from './NamedAsyncIterable.ts'

/*
Call signature shared by RemoteFunction and RawRemoteFunction. The base
signature keeps `args` required so a schema'd rpc can't silently drop its
input; when `Args` admits undefined (no-input rpcs) an intersected
optional-arg signature lets call sites write `fn()` instead of
`fn(undefined)`. Intersection rather than a bare conditional so the type
stays callable while `Args` is still generic (cache() invokes producers
before `Args` resolves). FormData is the multipart upload escape hatch —
see RemoteFunction. The trailing `Opts` differs by variant: the smart bare
call (RemoteFunction) carries cache/stream options (SmartReadOptions), while
`.raw` (RawRemoteFunction) carries per-call transport options (RpcOptions:
signal/keepalive/priority/cache/headers). The server ignores either, so the
callable stays isomorphic.

A streaming `Resolved` (an `AsyncIterable<Frame>`, branded by jsonl()/sse()) makes
the bare call return a `NamedAsyncIterable<Frame>` synchronously — the iterable IS the
value, consumed by `for await` or `state(fn(args))`, no `.stream()`. Every other
`Resolved` stays `Promise<Resolved>`. `await`-ing a streaming call is a compile
error (a NamedAsyncIterable is not awaitable), which replaces the old runtime guard.
*/
/* `[Resolved] extends [never]` first: a handler that only ever returns error() resolves to
   `never`, and `never extends AsyncIterable` is vacuously true — without this guard its call
   would mistype as a NamedAsyncIterable. A real streaming rpc's `Resolved` is `AsyncIterable<Frame>`. */
type CallResult<Resolved> = [Resolved] extends [never]
    ? Promise<Resolved>
    : Resolved extends AsyncIterable<infer Frame>
      ? NamedAsyncIterable<Frame>
      : Promise<Resolved>

export type RemoteCallable<Args, Resolved, Opts = RpcOptions> = ((
    args: Args | FormData,
    opts?: Opts,
) => CallResult<Resolved>) &
    (undefined extends Args
        ? (args?: Args | FormData, opts?: Opts) => CallResult<Resolved>
        : unknown)
