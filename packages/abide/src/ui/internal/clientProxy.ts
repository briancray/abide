// CLIENT RPC PROXY — the module-swap runtime (rpc-core §6, abide-compiler C2 hydration).
//
// On the server a page imports the real `Rpc` (its handler runs in-process, cache-backed). At
// build time the bundler swaps that import for a synthesized CLIENT proxy that speaks the SAME
// cell surface but reaches the handler over HTTP. The page code is unchanged — same callable,
// same name, same intent (isomorphism by default).
//
// READS (GET/HEAD) get wrapped in a `cell`, so the browser proxy caches, coalesces, and is
// reactive exactly like the server Rpc: `(args)` reactive peek, `.load`, `.peek`, `.pending`,
// `.error`, `.refresh`, `.invalidate`. The cell's inner fn fetches `/rpc/<name>?__abide_args=…` and
// parses JSON. MUTATIONS (POST/PUT/PATCH/DELETE) are a plain async callable — a JSON-body POST
// with `Content-Type: application/json` (satisfies the CSRF gate), never cached.

import type { Mutation, Rpc } from '../../server/internal/makeRpc.ts'
import { cell } from '../../shared/cell.ts'
import { cacheChannelName } from '../../shared/internal/cacheChannelName.ts'
import { canonicalKey } from '../../shared/internal/codec.ts'
import {
    decodeStreamResponse,
    isStreamContentType,
} from '../../shared/internal/decodeStreamResponse.ts'
import { RPC_QUERY_PARAMS } from '../../shared/internal/RPC_QUERY_PARAMS.ts'
import { applyCacheFrame } from './applyCacheFrame.ts'
import { subscribeCacheChannel } from './cacheMux.ts'

// An HttpError-like carrier for a non-2xx RPC response. Mirrors the `abide/shared/HttpError`
// shape (status/statusText/kind?/data?) so client code can narrow on it without importing the
// server error module.
class HttpErrorLike extends Error {
    readonly status: number
    readonly statusText: string
    readonly kind?: string
    readonly data?: unknown

    constructor(
        status: number,
        statusText: string,
        message: string,
        kind?: string,
        data?: unknown,
    ) {
        super(message)
        this.name = 'HttpError'
        this.status = status
        this.statusText = statusText
        if (kind !== undefined) this.kind = kind
        if (data !== undefined) this.data = data
    }
}

function readUrl(base: string, name: string, args: unknown): string {
    const query =
        args !== undefined
            ? `?${RPC_QUERY_PARAMS.args}=${encodeURIComponent(JSON.stringify(args))}`
            : ''
    return `${base}/__abide/rpc/${name}${query}`
}

// Turn a non-2xx Response into an HttpError-like. The abide error body is
// `{ status, statusText, message, ... }` (or a typed-error body with `name`/`data`); fall back
// to the response status line when the body is not the expected JSON shape.
async function toHttpError(response: Response): Promise<HttpErrorLike> {
    let body: Record<string, unknown> | undefined
    try {
        const parsed = await response.json()
        if (parsed !== null && typeof parsed === 'object') body = parsed as Record<string, unknown>
    } catch {
        body = undefined
    }
    const status = typeof body?.status === 'number' ? body.status : response.status
    const statusText = typeof body?.statusText === 'string' ? body.statusText : response.statusText
    const message =
        typeof body?.message === 'string' ? body.message : statusText || `HTTP ${status}`
    const kind = typeof body?.name === 'string' ? body.name : undefined
    return new HttpErrorLike(status, statusText, message, kind, body?.data)
}

function isRead(method: string): boolean {
    return method === 'GET' || method === 'HEAD'
}

// The mutation request shape (client → `/rpc/<name>`): a plain-object arg is JSON (`content-type:
// application/json` satisfies the CSRF gate); a FormData arg is sent raw (the browser sets the
// multipart boundary) with the `x-abide` header a cross-site form can't forge (TODO #8 upload).
function mutationInit(method: string, args: unknown): RequestInit {
    const isFormData = typeof FormData !== 'undefined' && args instanceof FormData
    return {
        method,
        headers: isFormData
            ? { 'x-abide': '1' }
            : { 'content-type': 'application/json', 'x-abide': '1' },
        body: isFormData ? (args as FormData) : JSON.stringify(args ?? {}),
    }
}

// A single client proxy for BOTH reads and mutations — full symmetry with the server. The only
// differences are transport (a read GETs with `?__abide_args=`; a mutation POSTs the body + CSRF header) and
// the default cache policy (carried by the spec's `ttl`: reads retain, mutations coalesce-only). Every
// probe/verb (peek/pending/refreshing/refresh/invalidate/amend/watch/chunks/done/raw) is attached for
// both, so an author who caches a mutation (`cache: { ttl }`) gets the identical reactive surface.
export function clientProxy<Args = unknown, T = unknown>(
    name: string,
    method: string,
    opts?: { base?: string; shared?: boolean; cache?: boolean; ttl?: number | null },
): Rpc<Args, T> | Mutation<Args, T> {
    const base = opts?.base ?? ''
    const read = isRead(method)
    // A read OR mutation whose author set `cache: false` bypasses the client cell on the bare call
    // (direct fetch every time; at-least-once for a mutation), mirroring the server. Default reads and
    // mutations are celled.
    const celled = opts?.cache !== false

    // Transport + decode: a jsonl/sse response decodes to an AsyncIterable (ReplayableStream) so a
    // streaming handler is consumed identically on both sides (`{#for await x of rpc()}`); a value
    // response parses JSON. Same for reads and mutations — only the request differs.
    const load = async (args: Args | FormData): Promise<T> => {
        const response = read
            ? await fetch(readUrl(base, name, args), { method })
            : await fetch(`${base}/__abide/rpc/${name}`, mutationInit(method, args))
        if (!response.ok) throw await toHttpError(response)
        if (isStreamContentType(response.headers.get('content-type'))) {
            return decodeStreamResponse(response) as unknown as T
        }
        return (await response.json()) as T
    }

    // `ttl: null`/undefined → the cell default (Infinity, retain until invalidate) — a read's policy. A
    // mutation's spec carries `ttl: 0` by default (coalesce concurrent, retain nothing); `cache: { ttl }`
    // carries the author's value so a cached mutation retains on the client too.
    const ttl = opts?.ttl
    const loadForCell = load as (args: Args) => Promise<T>
    const backing =
        ttl === null || ttl === undefined
            ? cell<Args, T>(loadForCell)
            : cell<Args, T>(loadForCell, { ttl })

    // A `shared` route broadcasts cache verbs on its `(rpc,args)` channel (rpc-core §8). On the FIRST
    // read for a given args the browser cell auto-joins that channel and mirrors inbound frames through
    // its own verbs. Dedup by canonicalKey; a non-shared route never subscribes. No-op under SSR.
    const shared = opts?.shared === true
    const subscribed = new Set<string>()
    const ensureSubscribed = (args: Args): void => {
        if (!shared) return
        const key = canonicalKey(args)
        if (subscribed.has(key)) return
        subscribed.add(key)
        subscribeCacheChannel(
            cacheChannelName(name, args),
            args,
            (frame) => applyCacheFrame(backing, args, frame),
            base,
        )
    }

    // THE CALL (Promise-read model): a celled read or mutation routes through the cell (coalesce +
    // subscribe the reactive context so `{await fn()}` re-awaits on invalidate). A `cache: false` call
    // (read OR mutation) bypasses the cell — every call runs (direct fetch; at-least-once for a
    // mutation), mirroring the server. A FormData mutation body always bypasses (can't be keyed).
    const rpc = ((args: Args | FormData): Promise<T> => {
        if (!celled || (!read && typeof FormData !== 'undefined' && args instanceof FormData)) {
            return load(args)
        }
        ensureSubscribed(args as Args)
        return backing(args as Args)
    }) as Rpc<Args, T>
    rpc.peek = (args: Args): T | undefined => {
        ensureSubscribed(args)
        return backing.peek(args)
    }
    rpc.load = (args: Args): Promise<T> => {
        ensureSubscribed(args)
        return backing.load(args)
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
    // Raw fetch, full bypass of the cell — the untouched `Response` (no parse, no `!ok` throw). A read
    // GETs `?__abide_args=`; a mutation POSTs the body + CSRF header. `init` overrides wholesale.
    rpc.raw = (args: Args | FormData, init?: RequestInit): Promise<Response> =>
        read
            ? fetch(readUrl(base, name, args), { method, ...(init ?? {}) })
            : fetch(`${base}/__abide/rpc/${name}`, {
                  ...mutationInit(method, args),
                  ...(init ?? {}),
              })
    rpc.isError = (e: unknown, name: string): boolean =>
        e !== null &&
        typeof e === 'object' &&
        ((e as Record<string, unknown>).kind === name ||
            (e as Record<string, unknown>).name === name)
    rpc.refresh = (args?: Args): void => backing.refresh(args)
    rpc.invalidate = (args?: Args): void => backing.invalidate(args)
    rpc.amend = (args: Args, next: T | ((current: T | undefined) => T)): void =>
        backing.amend(args, next)
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

// Build the imports map injected into a page's client mount: RPC name -> its client proxy. Each
// spec carries the verb, kind, and cache policy harvested from the server module's `__rpc` meta.
export function makeClientImports(
    specs: Record<
        string,
        { method: string; read: boolean; shared?: boolean; cache?: boolean; ttl?: number | null }
    >,
    base?: string,
): Record<string, unknown> {
    const imports: Record<string, unknown> = {}
    for (const [name, spec] of Object.entries(specs)) {
        imports[name] = clientProxy(name, spec.method, {
            base: base ?? '',
            shared: spec.shared === true,
            // Absent → celled (default); only an explicit `false` opts the call out of the cell.
            cache: spec.cache !== false,
            ttl: spec.ttl ?? null,
        })
    }
    return imports
}
