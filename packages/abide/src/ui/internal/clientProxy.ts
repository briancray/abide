// CLIENT RPC PROXY — the module-swap runtime (rpc-core §6, abide-compiler C2 hydration).
//
// On the server a page imports the real `Rpc` (its handler runs in-process, cache-backed). At
// build time the bundler swaps that import for a synthesized CLIENT proxy that speaks the SAME
// memo surface but reaches the handler over HTTP. The page code is unchanged — same callable,
// same name, same intent (isomorphism by default).
//
// READS (GET/HEAD) get wrapped in a `memo`, so the browser proxy caches, coalesces, and is
// reactive exactly like the server Rpc: `(args)` reactive peek, `.load`, `.peek`, `.pending`,
// `.error`, `.refresh`, `.invalidate`. The memo's inner fn fetches `/rpc/<name>?__abide_args=…` and
// parses JSON. MUTATIONS (POST/PUT/PATCH/DELETE) are a plain async callable — a JSON-body POST
// with `Content-Type: application/json` (satisfies the CSRF gate), never cached.

import { canonicalKey } from '../../shared/internal/codec.ts'
import {
    decodeStreamResponse,
    isStreamContentType,
} from '../../shared/internal/decodeStreamResponse.ts'
import { isTypedError } from '../../shared/internal/isTypedError.ts'
import { memoChannelName } from '../../shared/internal/memoChannelName.ts'
import { memoOptionsFor } from '../../shared/internal/memoOptionsFor.ts'
import { applyTagFrame } from '../../shared/internal/memoTags.ts'
import { outgoingTraceparent } from '../../shared/internal/outgoingTraceparent.ts'
import { rpcMemoPolicy } from '../../shared/internal/rpcMemoPolicy.ts'
import type { RpcSpecInput, RpcSpecPolicyInput } from '../../shared/internal/rpcSpec.ts'
import type {
    MutationCallSurface,
    RpcCallOptions,
    RpcCallSurface,
} from '../../shared/internal/rpcSurface.ts'
import { rpcUrl } from '../../shared/internal/rpcUrl.ts'
import { toHttpError } from '../../shared/internal/toHttpError.ts'
import { withAbort } from '../../shared/internal/withAbort.ts'
import { type MemoOptions, memo } from '../../shared/memo.ts'
import { applyMemoFrame } from './applyMemoFrame.ts'
import { subscribeMemoChannel, subscribeTagChannel } from './mux.ts'

// Address is `rpcUrl` (shared with the CLI, the loopback door and stream resume); HEADERS are this
// module's own, because a browser's are genuinely different from a CLI's.
function readUrl(base: string, name: string, args: unknown): string {
    return rpcUrl(base, name, { args })
}

function isRead(method: string): boolean {
    return method === 'GET' || method === 'HEAD'
}

// CO2.3 — the trace header for an RPC call, so the handler's server work joins the trace of the page
// that called it (`rpc = memo + transport`, and the transport is where the trace crosses). Empty
// before any page has adopted a trace, and empty CROSS-ORIGIN by deliberate omission:
//   • `traceparent` is not a CORS-safelisted request header, so adding it to a read would turn a
//     simple GET into a preflighted one — an extra round trip per read for a bundle/remote app
//     (`ABIDE_APP_URL`), which is a steep price for a correlation id;
//   • W3C's own privacy guidance is not to hand trace context to a receiver you don't control, and a
//     cross-origin `base` is exactly the case abide cannot vouch for.
// A cross-origin caller that WANTS to carry one still can — `traceparent` is in the default CORS
// allowed-headers list, so the server accepts it; it is the browser proxy that declines to volunteer.
function traceHeaders(sameOrigin: boolean): Record<string, string> {
    if (!sameOrigin) return {}
    const traceparent = outgoingTraceparent()
    return traceparent === undefined ? {} : { traceparent }
}

// Does `base` point back at the origin serving this page? An empty base is same-origin by
// construction (a relative URL). An unparseable base is treated as cross-origin — fail closed.
function isSameOrigin(base: string): boolean {
    if (base === '') return true
    if (typeof location === 'undefined') return false
    try {
        return new URL(base, location.href).origin === location.origin
    } catch {
        return false
    }
}

// The mutation request shape (client → `/rpc/<name>`): a plain-object arg is JSON (`content-type:
// application/json` satisfies the CSRF gate); a FormData arg is sent raw (the browser sets the
// multipart boundary) with the `x-abide` header a cross-site form can't forge (TODO #8 upload).
function mutationInit(method: string, args: unknown, sameOrigin: boolean): RequestInit {
    const isFormData = typeof FormData !== 'undefined' && args instanceof FormData
    return {
        method,
        headers: isFormData
            ? { 'x-abide': '1', ...traceHeaders(sameOrigin) }
            : {
                  'content-type': 'application/json',
                  'x-abide': '1',
                  ...traceHeaders(sameOrigin),
              },
        body: isFormData ? (args as FormData) : JSON.stringify(args ?? {}),
    }
}

// A single client proxy for BOTH reads and mutations — full symmetry with the server. The only
// differences are transport (a read GETs with `?__abide_args=`; a mutation POSTs the body + CSRF header) and
// the default cache policy (carried by the spec's `ttl`: reads retain, mutations coalesce-only). Every
// probe/verb (peek/pending/refreshing/refresh/invalidate/publish/watch/chunks/done/raw) is attached for
// both, so an author who caches a mutation (`memo: { ttl }`) gets the identical reactive surface.
export function clientProxy<Args = unknown, T = unknown>(
    name: string,
    method: string,
    // The wire spec (`RpcEntry`), which IS the normalized policy plus transport. Every field admits an
    // explicit `undefined` so a caller can forward the spec straight through — re-deriving a default
    // here to satisfy `exactOptionalPropertyTypes` is how a fourth copy of the policy grew in
    // `makeClientImports`.
    opts?: RpcSpecPolicyInput & { base?: string | undefined },
): RpcCallSurface<Args, T> | MutationCallSurface<Args, T> {
    const base = opts?.base ?? ''
    const read = isRead(method)
    // Decided once per proxy, not per call: `base` is fixed for the proxy's life.
    const sameOrigin = isSameOrigin(base)
    // The BROWSER half of the memo policy — normalized by the same function the server memo and the wire
    // spec go through (`shared/internal/rpcMemoPolicy`), so the two memos are built from one answer
    // rather than from two ladders that have to be kept in step. They were not in step: a `memo: false`
    // READ ran at ttl:0 on the server and ttl:Infinity here, because the spec's `ttl: null` fell through
    // to the memo's own default. `rpcMemoPolicy` is IDEMPOTENT, which is what makes re-normalizing an
    // already-normalized spec correct; a spec with fields absent (a hand-built proxy) still lands on the
    // per-verb defaults, in the one place they are written down.
    const policy = rpcMemoPolicy(
        opts?.memo === false
            ? false
            : {
                  ttl: opts?.ttl,
                  crossRequest: opts?.crossRequest,
                  tags: opts?.tags,
                  throttle: opts?.throttle,
                  debounce: opts?.debounce,
              },
        read,
    )
    // A call whose author opted the bare call out of the memo (a `memo: false` mutation) fetches
    // directly — at-least-once, no coalescing — mirroring the server.
    const memoed = policy.memoed
    // The rpc's run deadline, BAKED at build time (ADR 0028 D6/D9). `0` = unbounded. The client half is
    // an independent enforcement of the same number, not the far end of one timer: this clock includes
    // DNS, connect, HTTP/1 connection queueing and body read, none of which the server's sees — so for a
    // browser call it is the one that fires. Aborting the fetch closes the connection, which is what the
    // server reads as "the client aborted" (D4).
    const timeout = opts?.timeout ?? 0

    // Compose the run deadline with a caller-supplied signal (D3). The caller's aborts THEIR wait; the
    // deadline aborts the work — two different owners, so the fetch honours whichever fires first rather
    // than letting one replace the other.
    const callSignal = (signal?: AbortSignal | null): AbortSignal | undefined => {
        const deadline = timeout > 0 ? AbortSignal.timeout(timeout) : undefined
        if (deadline === undefined) return signal ?? undefined
        if (signal === undefined || signal === null) return deadline
        return AbortSignal.any([deadline, signal])
    }

    // Transport + decode: a jsonl/sse response decodes to an AsyncIterable (ReplayableStream) so a
    // streaming handler is consumed identically on both sides (`{#for await x of rpc()}`); a value
    // response parses JSON. Same for reads and mutations — only the request differs.
    const load = async (args: Args | FormData, signal?: AbortSignal): Promise<T> => {
        const armed = callSignal(signal)
        const response = read
            ? await fetch(readUrl(base, name, args), {
                  method,
                  headers: traceHeaders(sameOrigin),
                  ...(armed !== undefined ? { signal: armed } : {}),
              })
            : await fetch(`${base}/__abide/rpc/${name}`, {
                  ...mutationInit(method, args, sameOrigin),
                  ...(armed !== undefined ? { signal: armed } : {}),
              })
        if (!response.ok) throw await toHttpError(response)
        if (isStreamContentType(response.headers.get('content-type'))) {
            return decodeStreamResponse(response) as unknown as T
        }
        return (await response.json()) as T
    }

    // Deliberately a 1-arg wrapper: the memo classifies a body by `fn.length` (auto-tracked vs
    // args-keyed), so handing it `load`'s 2-arg shape directly would let a transport detail decide a
    // reactivity question.
    const loadForMemo = (args: Args): Promise<T> => load(args)
    // Tags reach the CLIENT memo (rpc-core §8): the tag verbs are isomorphic, so a `refresh({ tags })`
    // or `invalidate({ tags })` in the browser selects this proxy's memo and re-runs every live slot —
    // one registration per rpc, since a client proxy is a module singleton with one slot per args-key.
    // The SWR refetch clock (rpc-core §3) reaches it for the same reason — it is bilateral — and this is
    // the half that earns it: a socket broadcast storm calling `fn.refresh()` is a browser-side stream
    // of triggers, which is exactly what the clock collapses.
    const tags = policy.tags
    // The client memo carries the deadline too, so a timed-out slot EXPIRES rather than caching its
    // TimeoutError for the rest of a read's infinite ttl (ADR 0028 D7). The fetch above is already
    // armed; this is what makes the next read run cold instead of re-rejecting from the slot. The
    // deadline is the ONE memo option that is not the shared policy's: it is transport, not retention.
    const memoOptions: MemoOptions = memoOptionsFor(policy)
    memoOptions.timeout = timeout
    const backing = memo<Args, T>(loadForMemo, memoOptions)

    // A `crossRequest` route broadcasts cache verbs on its `(rpc,args)` channel (rpc-core §8). On the
    // FIRST read for a given args the browser memo auto-joins that channel and mirrors inbound frames
    // through its own verbs. Dedup by canonicalKey; a per-request route never subscribes. No-op under SSR.
    const crossRequest = policy.crossRequest
    const subscribed = new Set<string>()
    const ensureSubscribed = (args: Args): void => {
        if (!crossRequest) return
        const key = canonicalKey(args)
        if (subscribed.has(key)) return
        subscribed.add(key)
        subscribeMemoChannel(
            memoChannelName(name, args),
            args,
            (frame) => applyMemoFrame(backing, args, frame),
            base,
        )
    }

    // A TAGGED route additionally joins one `@tag:<tag>` channel per declared tag, so a server-side
    // `refresh/invalidate({ tags })` reaches this browser. This is what makes the tag verbs work for a
    // read that is NOT `crossRequest`: the `@rpc:` channel above is per-`(rpc,args)` and only a
    // crossRequest route has one, whereas a tag frame is addressed to the tag itself.
    //
    // Joined once per proxy on first read (not per args) — a tag is not keyed. `muxSubscribe` dedups on
    // the channel name, so several proxies sharing a tag still open exactly one subscription. The
    // inbound frame drives the LOCAL registry, which reaches every memo carrying the tag, this one
    // included; `applyTagFrame` deliberately does not re-publish.
    let tagsJoined = false
    const ensureTagsSubscribed = (): void => {
        if (tagsJoined || tags === undefined || tags.length === 0) return
        tagsJoined = true
        for (const tag of tags) {
            subscribeTagChannel(
                tag,
                (frame) => {
                    if (frame.verb === 'publish') return // a tag channel carries no value
                    applyTagFrame(tag, frame.verb)
                },
                base,
            )
        }
    }

    // THE CALL (Promise-read model): a memoed read or mutation routes through the memo (coalesce +
    // subscribe the reactive context so `{await fn()}` re-awaits on invalidate). A `memo: false`
    // MUTATION bypasses it — every call runs, at-least-once, no coalescing — while a `memo: false` READ
    // stays memo-backed at ttl:0, which retains nothing so every call still runs, and which is what the
    // server does with the same declaration (`policy.memoed`). A FormData mutation body always bypasses
    // (can't be keyed).
    // A caller's `signal` (ADR 0028 D3) reaches the two paths differently, and the difference is the
    // decision: a memo-BACKED call detaches the waiter only, because the run fills a slot other callers
    // are coalesced onto; a bypassing call has no slot and exactly one consumer, so its signal goes
    // straight to `fetch` and really cancels the request.
    const rpc = ((args: Args | FormData, options?: RpcCallOptions): Promise<T> => {
        if (!memoed || (!read && typeof FormData !== 'undefined' && args instanceof FormData)) {
            return load(args, options?.signal)
        }
        ensureSubscribed(args as Args)
        ensureTagsSubscribed()
        return withAbort(backing(args as Args), options?.signal)
    }) as unknown as RpcCallSurface<Args, T>
    rpc.peek = (args: Args): T | undefined => {
        ensureSubscribed(args)
        ensureTagsSubscribed()
        return backing.peek(args)
    }
    rpc.pending = (args: Args): boolean => backing.pending(args)
    rpc.refreshing = (args: Args): boolean => backing.refreshing(args)
    rpc.error = (args: Args): unknown => backing.error(args)
    // Streaming chunk probes (the `StreamRead`/`StreamMutation` surface): `peek` above is already
    // stream-aware (latest chunk); forward `chunks` (transcript) + `done` (closed?) too. A scalar route
    // never calls these; only the streaming type surfaces them.
    const streamRpc = rpc as unknown as {
        chunks: (args: Args) => unknown[] | undefined
        done: (args: Args) => boolean
    }
    streamRpc.chunks = (args: Args): unknown[] | undefined => backing.chunks(args)
    streamRpc.done = (args: Args): boolean => backing.done(args)
    rpc.watch = (args: Args, handler: (value: T | undefined) => void): (() => void) =>
        backing.watch(args, handler)
    // Raw fetch, full bypass of the memo — the untouched `Response` (no parse, no `!ok` throw). A read
    // GETs `?__abide_args=`; a mutation POSTs the body + CSRF header. `init` overrides wholesale.
    rpc.raw = (args: Args | FormData, init?: RequestInit): Promise<Response> => {
        // `.raw` bypasses the MEMO, not the deadline (ADR 0028 D6). `init` still overrides wholesale, but
        // its `signal` is COMPOSED with the run deadline rather than replacing it — a caller reaching for
        // the escape hatch is asking for transport control, not for an unbounded request.
        const armed = callSignal(init?.signal)
        return read
            ? fetch(readUrl(base, name, args), {
                  method,
                  headers: traceHeaders(sameOrigin),
                  ...(init ?? {}),
                  ...(armed !== undefined ? { signal: armed } : {}),
              })
            : fetch(`${base}/__abide/rpc/${name}`, {
                  ...mutationInit(method, args, sameOrigin),
                  ...(init ?? {}),
                  ...(armed !== undefined ? { signal: armed } : {}),
              })
    }
    rpc.isError = isTypedError
    rpc.refresh = (args?: Args): void => backing.refresh(args)
    rpc.invalidate = (args?: Args): void => backing.invalidate(args)
    rpc.publish = (args: Args, next: T | ((current: T | undefined) => T)): void =>
        backing.publish(args, next)
    rpc.snapshot = (): Array<{ args: Args; value: T }> => backing.snapshot()
    rpc.seed = (args: Args, value: T): void => backing.seed(args, value)
    rpc.seedStream = (
        args: Args,
        source: readonly unknown[] | AsyncIterable<unknown>,
        encoding?: 'jsonl' | 'sse',
    ): void => backing.seedStream(args, source, encoding)
    rpc.bindBroadcast = (): void => {} // server-only seam; inert on the client proxy
    return rpc
}

// ONE proxy per `(base, rpc name)` for the life of the tab. Two places already asserted this and
// neither was true: the tag registration above ("one registration per rpc, since a client proxy is a
// module singleton"), and the documented reach of `refresh({ tags })` ("slots live for the tab, so this
// reaches args-keys no longer on screen"). `makeClientImports` is called from `buildPageScope`, i.e.
// once per MOUNT, so before this cache every navigation minted a fresh proxy — a fresh memo, a fresh
// slot map, a fresh tag registration.
//
// The registration is the sharp end. `memo.ts` disposes it through an effect scope or a request scope,
// and a client proxy is in neither — its own comment says so, on the premise that client proxies are
// module-level and "stay registered for the process, which is exactly as long as [they] live". Per-mount
// proxies live for one navigation, so every nav left a permanent entry in a process-global registry that
// nothing drains, each pinning its whole slot map through the `selectSlots`/`dropSlot` closures. After N
// navigations a `refresh({ tags })` re-ran N generations of dead memos.
//
// Keyed on base too: a cross-origin proxy (`ABIDE_APP_URL`) is a different endpoint with different
// slots, and collapsing the two would serve one origin's cache to the other.
const clientProxyCache = new Map<string, unknown>()

// Drop every cached proxy — TESTS ONLY, and required by them: the cache is module state, so without
// this one test's warmed slots are the next test's starting cache. The sibling of `clearTagRegistry`.
export function clearClientProxyCache(): void {
    clientProxyCache.clear()
}

// Build the imports map injected into a page's client mount: RPC name -> its client proxy. Each
// spec carries the verb, kind, and cache policy harvested from the server module's `__rpc` meta.
export function makeClientImports(
    specs: Record<string, RpcSpecInput>,
    base?: string,
): Record<string, unknown> {
    const imports: Record<string, unknown> = {}
    for (const [name, spec] of Object.entries(specs)) {
        const key = `${base ?? ''} ${name}`
        let proxy = clientProxyCache.get(key)
        if (proxy === undefined) {
            // Forwarded VERBATIM: the spec is the server's normalized policy, and `clientProxy` runs it
            // back through the same normalizer. Filling in defaults here (`spec.ttl ?? null`, `spec.memo
            // !== false`) is what made the browser's policy a second derivation of the server's.
            proxy = clientProxy(name, spec.method, {
                base: base ?? '',
                crossRequest: spec.crossRequest,
                memo: spec.memo,
                ttl: spec.ttl,
                tags: spec.tags,
                throttle: spec.throttle,
                debounce: spec.debounce,
                timeout: spec.timeout,
            })
            clientProxyCache.set(key, proxy)
        }
        imports[name] = proxy
    }
    return imports
}
