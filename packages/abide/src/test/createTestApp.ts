// createTestApp — an in-process app harness for tests (M2 + M7 auth). Boots the real router on
// an ephemeral port and hands back a small surface: `fetch` against the live origin, an `rpc`
// proxy that calls registered routes with the right verb, a `health` probe, `stop`, and `as`
// for impersonating an identity.
//
// TWO MODES (createTestApp is async either way):
//   • EXPLICIT — the config names at least one SURFACE (`routes`/`sockets`/`pages`/`layouts`/
//     `middleware`/…). Only what you name is registered — a hermetic app, no filesystem scan, no
//     lifecycle. This is the classic unit-test shape.
//   • DISCOVERY — the config names NO surface (`createTestApp()`, `createTestApp({})`, or only the
//     control knobs `dir`/`lifecycle`). The whole project at `dir` (default `process.cwd()`) is
//     loaded via `loadApp` — every `src/server/rpc/**`, socket, page, layout, and `src/app.ts`
//     middleware/lifecycle — and booted through its `onStart`/`onStop` hooks (unless `lifecycle:
//     false`). Use this to integration-test against the REAL app.
//
// `as(identity)` does not start a second server — it returns a sibling TestApp bound to the
// same origin that stamps an `Authorization: Bearer <sealed identity>` header onto every
// request, exercising the real per-user-token rung of the identity ladder (AU9). The rpc proxy
// sends Content-Type: application/json on mutations so they satisfy the CSRF gate (AU8).

import { loadApp } from '../server/internal/loadApp.ts'
import type { Middleware } from '../server/internal/middleware.ts'
import { type App, createApp, type Route } from '../server/internal/router.ts'
import type { Principal } from '../server/internal/scope.ts'
import { seal } from '../server/internal/seal.ts'
import type { ErasedSocket } from '../server/socket.ts'
import { RPC_QUERY_PARAMS } from '../shared/internal/RPC_QUERY_PARAMS.ts'
import { subscriptionKey } from '../shared/internal/subscriptionKey.ts'

// A thin test client over the multiplexed socket WS (`/__abide/sockets`). `subscribe(name)`
// yields the framed messages for that socket; `publish(name, msg)` sends a client publish. Close
// it (or the app) to release the connection.
export interface SocketClient {
    ready(): Promise<void>
    // `args` is the ROOM for a roomed user socket (ADR 0023) — and the raw args that must NAME the
    // channel for an `@rpc:` cache-channel subscribe (the args-spoof defense). Omit for a void socket.
    subscribe<T = unknown>(name: string, args?: unknown): AsyncIterable<T>
    publish(name: string, message: unknown, args?: unknown): void
    // Resolves to the server's subscribe verdict for `(name, args)`: `'ok'` (sub-ack) or `'error'`
    // (sub-error — unknown socket or a denied room). Lets a test assert per-room authorization.
    ack(name: string, args?: unknown): Promise<'ok' | 'error'>
    close(): void
}

export interface TestApp {
    origin: string
    fetch(path: string, init?: RequestInit): Promise<Response>
    rpc: Record<string, (args?: unknown) => Promise<unknown>>
    socket(name?: string): SocketClient
    health(): Promise<Response>
    stop(): Promise<void>
    as(identity: Partial<Principal>): TestApp
}

// NOTE (contract deviation): the fixed sketch typed `routes` as `Record<string, Rpc<any, any>>`,
// but the mutation verbs (POST/PUT/PATCH/DELETE) produce `Mutation`, which is not assignable to
// `Rpc`. Widened to `Route` (the `Rpc | Mutation` union) so both reads and mutations register.
export interface TestAppConfig {
    routes?: Record<string, Route>
    middleware?: Middleware[]
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous socket record; Socket is contravariant in its message type so `unknown` rejects concrete `Socket<T>` values
    sockets?: Record<string, ErasedSocket>
    pages?: Record<string, string>
    layouts?: Record<string, string>
    // TODO #20: absolute source dirs (keyed like `pages`/`layouts`) so the client bundle can resolve a
    // page/layout's relative CSS imports. Normally populated by the file loader; exposed here for tests.
    pageDirs?: Record<string, string>
    layoutDirs?: Record<string, string>
    // DISCOVERY-mode control knobs (ignored in explicit mode — they are not surfaces, so setting one
    // alone still triggers discovery). `dir`: project root to scan (default `process.cwd()`).
    // `lifecycle`: run the discovered app's `onStart`/`onStop` hooks (default `true`; set `false` to
    // skip an expensive boot that a given test does not exercise).
    dir?: string
    lifecycle?: boolean
}

// A config names an explicit SURFACE (so: no discovery) when it registers any request-facing
// registry — routes, sockets, pages/layouts (or their dirs), or middleware. `dir`/`lifecycle` are
// control knobs, not surfaces, so they don't count. An empty `{}` (or no arg) names none → discovery.
function hasExplicitSurface(config: TestAppConfig): boolean {
    return (
        config.routes !== undefined ||
        config.sockets !== undefined ||
        config.pages !== undefined ||
        config.layouts !== undefined ||
        config.pageDirs !== undefined ||
        config.layoutDirs !== undefined ||
        config.middleware !== undefined
    )
}

// A minimal pushable async queue: producers `push`/`close`, one consumer iterates. Backs each
// live socket subscription on the test client.
class MessageQueue<T> implements AsyncIterable<T> {
    private readonly values: T[] = []
    private readonly waiting: ((result: IteratorResult<T>) => void)[] = []
    private closed = false

    push(value: T): void {
        if (this.closed) return
        const resolve = this.waiting.shift()
        if (resolve !== undefined) resolve({ value, done: false })
        else this.values.push(value)
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        for (const resolve of this.waiting) resolve({ value: undefined as never, done: true })
        this.waiting.length = 0
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
            next: (): Promise<IteratorResult<T>> => {
                if (this.values.length > 0)
                    return Promise.resolve({ value: this.values.shift() as T, done: false })
                if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
                return new Promise((resolve) => this.waiting.push(resolve))
            },
        }
    }
}

function socketClient(origin: string, identity: Partial<Principal> | undefined): SocketClient {
    // Keyed by `subscriptionKey(name, args)` so distinct rooms of one socket are distinct subscriptions.
    const queues = new Map<string, MessageQueue<unknown>[]>()
    // Subscribe verdicts, keyed the same way. `waiters` holds a pending `ack()` resolver; `settled`
    // buffers a verdict that arrived before `ack()` was called (so the ack is never missed on a race).
    const waiters = new Map<string, (verdict: 'ok' | 'error') => void>()
    const settled = new Map<string, 'ok' | 'error'>()
    let ws: WebSocket | undefined

    // Seal the impersonated identity into a Bearer header BEFORE opening the WS so the upgrade
    // resolves it through the real per-user-token rung of the identity ladder (matching HTTP `as`).
    // Bun's WebSocket accepts a non-standard `headers` option; the DOM lib type omits it (cast).
    const opened = (async (): Promise<void> => {
        const url = `${origin.replace(/^http/, 'ws')}/__abide/sockets`
        if (identity !== undefined) {
            const token = await seal(identity as Principal)
            ws = new WebSocket(url, {
                headers: { authorization: `Bearer ${token}` },
            } as unknown as string[])
        } else {
            ws = new WebSocket(url)
        }
        ws.addEventListener('message', (event) => {
            let frame: {
                name?: unknown
                args?: unknown
                msg?: unknown
                ok?: unknown
                error?: unknown
            }
            try {
                frame = JSON.parse(String(event.data))
            } catch {
                return
            }
            if (typeof frame.name !== 'string') return
            const key = subscriptionKey(frame.name, frame.args)
            // User-socket control frames (sub-ack `{name,ok}` / sub-error `{name,error}`, CS2): resolve
            // the pending ack, don't deliver as data.
            if (frame.ok !== undefined || frame.error !== undefined) {
                const verdict = frame.error !== undefined ? 'error' : 'ok'
                const waiter = waiters.get(key)
                if (waiter !== undefined) {
                    waiters.delete(key)
                    waiter(verdict)
                } else {
                    settled.set(key, verdict)
                }
                return
            }
            const list = queues.get(key)
            if (list === undefined) return
            for (const queue of list) queue.push(frame.msg)
        })
        const socket = ws
        await new Promise<void>((resolve, reject) => {
            socket.addEventListener('open', () => resolve())
            socket.addEventListener('error', (event) => reject(event))
        })
    })()

    return {
        ready: (): Promise<void> => opened,
        subscribe<T = unknown>(name: string, args?: unknown): AsyncIterable<T> {
            const key = subscriptionKey(name, args)
            const queue = new MessageQueue<T>()
            let list = queues.get(key) as MessageQueue<T>[] | undefined
            if (list === undefined) {
                list = []
                queues.set(key, list as MessageQueue<unknown>[])
            }
            list.push(queue)
            const frame = args !== undefined ? { t: 'sub', name, args } : { t: 'sub', name }
            void opened.then(() => {
                if (ws === undefined) throw new Error('socket not connected')
                ws.send(JSON.stringify(frame))
            })
            return queue
        },
        publish(name: string, message: unknown, args?: unknown): void {
            const frame =
                args !== undefined
                    ? { t: 'pub', name, args, msg: message }
                    : { t: 'pub', name, msg: message }
            void opened.then(() => {
                if (ws === undefined) throw new Error('socket not connected')
                ws.send(JSON.stringify(frame))
            })
        },
        ack(name: string, args?: unknown): Promise<'ok' | 'error'> {
            const key = subscriptionKey(name, args)
            const already = settled.get(key)
            if (already !== undefined) {
                settled.delete(key)
                return Promise.resolve(already)
            }
            return new Promise((resolve) => waiters.set(key, resolve))
        },
        close(): void {
            for (const list of queues.values()) for (const queue of list) queue.close()
            queues.clear()
            // Swallow a rejected `opened` (e.g. a denied/failed upgrade) so close() never throws.
            void opened.then(() => ws?.close()).catch(() => {})
            ws?.close()
        },
    }
}

// Read the abide-identity `Set-Cookie` back off a response as a `name=value` pair ready to send
// as a `Cookie` header, so tests can assert the login cookie and replay it on a follow-up.
export function identityCookie(response: Response): string | undefined {
    for (const cookie of response.headers.getSetCookie()) {
        if (cookie.startsWith('abide-identity=')) return cookie.split(';')[0]
    }
    return undefined
}

function bind(
    app: App,
    routes: Record<string, Route>,
    identity: Partial<Principal> | undefined,
    stop: () => Promise<void>,
): TestApp {
    const origin = app.origin

    async function decorate(init?: RequestInit): Promise<RequestInit> {
        const headers = new Headers(init?.headers)
        if (identity !== undefined) {
            const token = await seal(identity as Principal)
            headers.set('authorization', `Bearer ${token}`)
        }
        return { ...init, headers }
    }

    async function doFetch(path: string, init?: RequestInit): Promise<Response> {
        return fetch(origin + path, await decorate(init))
    }

    const rpc = new Proxy({} as Record<string, (args?: unknown) => Promise<unknown>>, {
        get(_target, property: string) {
            return async (args?: unknown): Promise<unknown> => {
                const route = routes[property]
                const read = route?.__rpc.read ?? false
                let response: Response
                if (read) {
                    const query =
                        args !== undefined
                            ? `?${RPC_QUERY_PARAMS.args}=${encodeURIComponent(JSON.stringify(args))}`
                            : ''
                    response = await doFetch(`/__abide/rpc/${property}${query}`, { method: 'GET' })
                } else if (args instanceof FormData) {
                    // TODO #8 multipart upload: send the FormData as the raw body (fetch sets the boundary)
                    // with the `x-abide` header so the CSRF gate admits it — no content-type header.
                    response = await doFetch(`/__abide/rpc/${property}`, {
                        method: 'POST',
                        headers: { 'x-abide': '1' },
                        body: args,
                    })
                } else {
                    response = await doFetch(`/__abide/rpc/${property}`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(args ?? {}),
                    })
                }
                return response.json()
            }
        },
    })

    return {
        origin,
        fetch: doFetch,
        rpc,
        socket: (_name?: string): SocketClient => socketClient(origin, identity),
        health: (): Promise<Response> => doFetch('/__abide/health'),
        stop,
        // A sibling shares the same server and the same `stop` — teardown (and any `onStop`) runs once.
        as: (asIdentity: Partial<Principal>): TestApp => bind(app, routes, asIdentity, stop),
    }
}

export async function createTestApp(config: TestAppConfig = {}): Promise<TestApp> {
    // EXPLICIT mode — the config names a surface, so register exactly it (hermetic, no lifecycle).
    if (hasExplicitSurface(config)) {
        const app = createApp(config)
        return bind(app, config.routes ?? {}, undefined, () => app.stop())
    }

    // DISCOVERY mode — load the whole project at `dir` and boot it through its lifecycle.
    const loaded = await loadApp(config.dir ?? process.cwd())
    const runLifecycle = config.lifecycle !== false

    // Mirror serve.ts: `createApp` binds the server inside the `start` thunk so `onStart` can do setup
    // BEFORE anything listens; returning without calling `start()` is a breakout (the app never boots).
    let app: App | undefined
    const start = async (): Promise<void> => {
        if (app === undefined) app = createApp(loaded)
    }
    if (runLifecycle && loaded.onStart !== undefined) await loaded.onStart(start)
    else await start()
    if (app === undefined) {
        throw new Error('abide: onStart returned without calling start() — the app did not boot.')
    }
    const booted = app

    // Teardown mirrors onStart: `onStop` wraps the real `stop()`, and it always completes (backstop).
    let stopped = false
    const rawStop = async (): Promise<void> => {
        if (stopped) return
        stopped = true
        await booted.stop()
    }
    const stop =
        runLifecycle && loaded.onStop !== undefined
            ? async (): Promise<void> => {
                  // A hook that throws (or returns without calling stop()) still gets the backstop,
                  // so teardown always completes; the original error is re-thrown for the caller.
                  try {
                      await loaded.onStop?.(rawStop)
                  } finally {
                      if (!stopped) await rawStop()
                  }
              }
            : rawStop

    return bind(booted, loaded.routes ?? {}, undefined, stop)
}
