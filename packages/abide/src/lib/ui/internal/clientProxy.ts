// CLIENT RPC PROXY — the module-swap runtime (rpc-core §6, abide-compiler C2 hydration).
//
// On the server a page imports the real `Rpc` (its handler runs in-process, cache-backed). At
// build time the bundler swaps that import for a synthesized CLIENT proxy that speaks the SAME
// cell surface but reaches the handler over HTTP. The page code is unchanged — same callable,
// same name, same intent (isomorphism by default).
//
// READS (GET/HEAD) get wrapped in a `cell`, so the browser proxy caches, coalesces, and is
// reactive exactly like the server Rpc: `(args)` reactive peek, `.load`, `.peek`, `.pending`,
// `.error`, `.refresh`, `.invalidate`. The cell's inner fn fetches `/rpc/<name>?args=…` and
// parses JSON. MUTATIONS (POST/PUT/PATCH/DELETE) are a plain async callable — a JSON-body POST
// with `Content-Type: application/json` (satisfies the CSRF gate), never cached.

import type { Mutation, Rpc } from '../../server/internal/makeRpc.ts'
import { cell } from '../../shared/cell.ts'
import { cacheChannelName } from '../../shared/internal/cacheChannelName.ts'
import { canonicalKey } from '../../shared/internal/codec.ts'
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
    const query = args !== undefined ? `?args=${encodeURIComponent(JSON.stringify(args))}` : ''
    return `${base}/rpc/${name}${query}`
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

export function clientProxy<Args = unknown, T = unknown>(
    name: string,
    method: string,
    opts?: { base?: string; shared?: boolean },
): Rpc<Args, T> | Mutation<Args, T> {
    const base = opts?.base ?? ''

    if (isRead(method)) {
        const backing = cell<Args, T>(async (args: Args): Promise<T> => {
            const response = await fetch(readUrl(base, name, args), { method })
            if (!response.ok) throw await toHttpError(response)
            return (await response.json()) as T
        })

        // A `shared` server read broadcasts cache verbs on its `(rpc,args)` channel (rpc-core §8). On the
        // FIRST read for a given args the browser cell auto-joins that channel and mirrors inbound frames
        // through its own local verbs. Dedup by canonicalKey so a reactive re-read never re-subscribes; a
        // non-shared read never subscribes. No-op under SSR (the mux guards on `window`/`WebSocket`).
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

        // THE READ (Promise-read model): the bare call is the coalesced load promise AND subscribes the
        // reactive context (so `{await fn()}` re-awaits on invalidate); `.peek()` is the sync snapshot.
        const rpc = ((args: Args): Promise<T> => {
            ensureSubscribed(args)
            return backing(args)
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
        rpc.watch = (args: Args, handler: (value: T | undefined) => void): (() => void) =>
            backing.watch(args, handler)
        // Raw fetch, full bypass of the cell — returns the untouched `Response` (no parse, no error throw).
        rpc.raw = (args: Args, init?: RequestInit): Promise<Response> =>
            fetch(readUrl(base, name, args), { method, ...(init ?? {}) })
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
        rpc.bindBroadcast = (): void => {} // server-only seam; inert on the client proxy
        return rpc
    }

    const mutation = (async (args: Args | FormData): Promise<T> => {
        // TODO #8 multipart upload: a `FormData` arg is sent as the raw body with NO content-type header
        // — the browser sets the `multipart/form-data` boundary — plus `x-abide` to pass the CSRF gate
        // (multipart is a CORS-simple content type, so the header is what a cross-site form can't forge).
        // A plain-object arg keeps the JSON path (content-type: application/json also satisfies CSRF).
        const isFormData = typeof FormData !== 'undefined' && args instanceof FormData
        const response = await fetch(`${base}/rpc/${name}`, {
            method,
            headers: isFormData
                ? { 'x-abide': '1' }
                : { 'content-type': 'application/json', 'x-abide': '1' },
            body: isFormData ? args : JSON.stringify(args ?? {}),
        })
        if (!response.ok) throw await toHttpError(response)
        return (await response.json()) as T
    }) as Mutation<Args, T>
    return mutation
}

// Build the imports map injected into a page's client mount: RPC name -> its client proxy. Each
// spec carries the verb and read/mutation kind harvested from the server module's `__rpc` meta.
export function makeClientImports(
    specs: Record<string, { method: string; read: boolean; shared?: boolean }>,
    base?: string,
): Record<string, unknown> {
    const imports: Record<string, unknown> = {}
    for (const [name, spec] of Object.entries(specs)) {
        imports[name] = clientProxy(name, spec.method, {
            base: base ?? '',
            shared: spec.shared === true,
        })
    }
    return imports
}
