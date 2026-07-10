import { attachRpcSelectorMethods } from './attachRpcSelectorMethods.ts'
import { cache } from './cache.ts'
import { HttpError } from './HttpError.ts'
import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { REMOTE_FUNCTION } from './REMOTE_FUNCTION.ts'
import { recordRemoteMeta } from './recordRemoteMeta.ts'
import { reviveWireOutput } from './reviveWireOutput.ts'
import { rpcErrorRegistry } from './rpcErrorRegistry.ts'
import { subscribableFromResponse } from './subscribableFromResponse.ts'
import type { CachePolicy } from './types/CachePolicy.ts'
import type { ClientFlags } from './types/ClientFlags.ts'
import type { HttpMethod } from './types/HttpMethod.ts'
import type { NamedAsyncIterable } from './types/NamedAsyncIterable.ts'
import type { OutputWirePlan } from './types/OutputWirePlan.ts'
import type { RawRemoteFunction } from './types/RawRemoteFunction.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'
import type { RpcOptions } from './types/RpcOptions.ts'
import type { StreamPolicy } from './types/StreamPolicy.ts'

/*
Assembles the public RemoteFunction shape used identically by the
server-side defineRpc (in-process handler invocation) and the
client-side remoteProxy (network fetch). Centralising the wiring here
keeps the call/raw/stream/fetch semantics — including WeakMap meta
recording, Content-Type decode, and NamedAsyncIterable derivation — in one
place so the two halves can't drift.

- `buildRequest(args)` synthesizes the Request a meta reader (cache()) or
  the client invoke needs. Server uses the inbound request's URL as the
  base; client uses window.location. The result is memoised inside the
  per-call `getRequest` thunk so the Request is built at most once per
  call regardless of how many readers pull on it.
- `invoke(args, getRequest)` actually runs the call: server defineRpc
  runs the handler and ignores `getRequest`; client remoteProxy calls
  `fetch(getRequest())`. The thunk lets the server skip the Request
  allocation entirely on the SSR hot path — the only consumer that ever
  forces it is cache(), via the meta thunk recorded below.
- `parseArgsForFetch` is optional and only set by the server, so the
  framework's router can call `.fetch(inboundRequest)` and have the
  handler receive parsed args. Client `remoteProxy.fetch` just
  forwards the request through invoke().
*/
export function createRemoteFunction<Args, Return>(opts: {
    method: HttpMethod
    url: string
    clients: ClientFlags
    /* Server-side only: exempts a mutating rpc from the router's same-origin CSRF gate. */
    crossOrigin?: boolean
    buildRequest: (args: Args | undefined, opts?: RpcOptions) => Request
    invoke: (
        args: Args | undefined,
        getRequest: () => Request,
        opts?: RpcOptions,
    ) => Promise<Response>
    parseArgsForFetch?: (request: Request) => Promise<Args | undefined>
    /* A streaming rpc (handler returns jsonl()/sse()): the bare call returns the NamedAsyncIterable
       directly (the iterable IS the value) rather than decoding one Response body. Emitted by
       the bundler's syntactic scan; false/undefined keeps the decode-a-Response path. */
    streaming?: boolean
    /* Endpoint cache/stream policy (ADR-0020) — stamped onto both callable variants so
       readThrough reads it as the bottom policy layer. Declared once on the rpc definition. */
    cache?: CachePolicy<Args>
    stream?: StreamPolicy
    /* Client-only: the output wire codec plan (ADR-0029) the remoteProxy stub carries — the decoded
       response body's structured fields are revived through it (a `Set`/`Map`/`bigint`/`Date`). The
       server defineRpc never sets it, so an in-process read is untouched. undefined leaves the body
       as its honest-JSON form. */
    outputWirePlan?: OutputWirePlan
}): RemoteFunction<Args, Return> {
    const {
        method,
        url,
        clients,
        crossOrigin,
        buildRequest,
        invoke,
        parseArgsForFetch,
        streaming,
        cache: cachePolicy,
        stream: streamPolicy,
        outputWirePlan,
    } = opts

    /*
    Dispatch is the one-stop entry for both the plain call (no prebuilt
    Request) and the fetch path (router hands us the inbound Request as
    `prebuilt`). The `getRequest` thunk lazily synthesizes — or
    short-circuits to the prebuilt one — and caches the result so the
    client invoke + the cache meta reader share a single Request.
    */
    function dispatch(
        args: Args | undefined,
        opts?: RpcOptions,
        prebuilt?: Request,
    ): Promise<Response> {
        let cached = prebuilt
        function getRequest(): Request {
            if (cached === undefined) {
                cached = buildRequest(args, opts)
            }
            return cached
        }
        const promise = invoke(args, getRequest, opts)
        recordRemoteMeta(promise, getRequest)
        return promise
    }

    /*
    A body rpc may receive a FormData in place of typed Args (the upload
    escape hatch). It flows through dispatch only into buildRpcRequest /
    keyForRemoteCall, both of which take it as-is, so the cast to Args is a
    contained type lie — buildRpcRequest's `instanceof FormData` branch handles
    it at runtime.
    */
    function rawCall(args: Args | FormData, opts?: RpcOptions): Promise<Response> {
        return dispatch(args as Args, opts)
    }
    rawCall.method = method
    rawCall.url = url
    /* Endpoint policy on both variants so readThrough can read it off whichever the caller
       passed (`fn` for the decoded read, `fn.raw` for the raw escape hatch). */
    rawCall.cache = cachePolicy
    rawCall.stream = streamPolicy
    /* Non-enumerable brand on both variants; see REMOTE_FUNCTION. */
    Object.defineProperty(rawCall, REMOTE_FUNCTION, { value: true })
    const raw = rawCall as RawRemoteFunction<Args>

    function callable(args: Args | FormData): Promise<Return> | NamedAsyncIterable<Return> {
        /* A streaming rpc (jsonl/sse) returns the NamedAsyncIterable directly — the iterable IS the
           value (for await / state(fn(args))). Deferred fetch, keyForRemoteCall-keyed so tail()
           dedupes readers; no decode, so the error-capture path below doesn't apply. */
        if (streaming) {
            return subscribableFromResponse(keyForRemoteCall(method, url, args), () =>
                raw(args as Args),
            )
        }
        /* The bare call IS the smart read: route through the cache store's smart-read
           path so a replayable read is coalesced, retained (SWR unconditional), and
           reactive, while a write is coalesce-only — the raw fetch moves to `.raw`.
           `cache.read(callable, …)` brand-reads `callable.raw` for the undecoded variant
           and decodes on the way out, so pass the callable (which carries `.raw`), not
           `raw`. There is no call-site options argument any more — all cache policy is read
           from the endpoint (`callable.cache`); per-call transport options live on `.raw`. */
        const key = keyForRemoteCall(method, url, args)
        return cache.read(callable as RemoteFunction<Args, Return>, args as Args).then(
            /* Capture the rejection into the rpc error registry (design Part 4) keyed by call
               identity, and clear it on success — the reactive `fn.error()` probe reads it. */
            (value) => {
                rpcErrorRegistry.clear(key)
                /* Revive the decoded body's structured fields per the baked output plan (ADR-0029):
                   a wire array → `Set`/`Map`, a digit string → `bigint`, an ISO string → `Date`. The
                   decoded value is call-private (a fresh decode or cloned warm value), so the revive
                   mutates in place. No plan (undefined — every server-side read, or a client endpoint
                   with no structured field) returns the value untouched. */
                return reviveWireOutput(value, outputWirePlan) as Return
            },
            (error: unknown) => {
                rpcErrorRegistry.record(key, error)
                throw error
            },
        )
    }
    callable.method = method
    callable.url = url
    callable.clients = clients
    callable.crossOrigin = crossOrigin
    callable.cache = cachePolicy
    callable.stream = streamPolicy
    callable.raw = raw
    /* Stamp the output wire codec plan (ADR-0029) so the public `cache(fn, args)` and
       `cache.peek(fn, args)` can revive the decoded body's structured fields (Set/Map/Date/bigint)
       exactly as the bare `fn(args)` read does above — otherwise those two read APIs return the raw
       honest-JSON form and disagree with `fn(args)`. A runtime affordance, not on the RemoteFunction
       surface (read via cast in cache.ts, like `settled`); undefined server-side / plan-less. */
    ;(callable as { outputWirePlan?: OutputWirePlan }).outputWirePlan = outputWirePlan
    /* Uniform runtime guard for every rpc — the per-rpc data typing lives entirely in the
       RpcErrorGuard<Errors> signature RemoteFunction projects onto it (Errors flows from the
       rpc helper's declared type, not from here). */
    callable.isError = (error: unknown, kind: string): boolean =>
        error instanceof HttpError && error.kind === kind
    Object.defineProperty(callable, REMOTE_FUNCTION, { value: true })
    callable.fetch = parseArgsForFetch
        ? async (request: Request): Promise<Response> => {
              let args: Args | undefined
              try {
                  args = await parseArgsForFetch(request)
              } catch (error) {
                  /*
                  Parse-stage rejections that already chose their wire shape
                  (readBodyWithinLimit's 413) return it; anything else (e.g.
                  malformed JSON) keeps propagating to the scope's catch.
                  Handler errors are outside this try on purpose — throwing
                  is the app.handleError path, `return error(...)` the wire one.
                  */
                  if (error instanceof HttpError) {
                      return error.response
                  }
                  throw error
              }
              return dispatch(args, undefined, request)
          }
        : (request: Request): Promise<Response> => {
              return dispatch(undefined, undefined, request)
          }
    attachRpcSelectorMethods(callable as RemoteFunction<Args, Return>)
    return callable as RemoteFunction<Args, Return>
}
