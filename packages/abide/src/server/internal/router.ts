// The abide APP — `createApp` boots `Bun.serve`, owns the boot-derived policy, and holds the WebSocket
// mux. THE REQUEST PIPELINE ITSELF IS `handleRequest.ts`: what happens to a request between arriving and
// leaving — trace mint, identity, scope, CSRF, the middleware onion, dispatch, and the one `exit()` every
// response goes through — lives there, as a named module rather than as a closure inside `fetch`.
//
// What stays here is everything that is about the SERVER rather than about a request:
//
//   • the boot-derived policy (`deriveRouterPolicy`) and the two REGISTRY BINDINGS beside it, which
//     mutate route callables rather than deriving a lookup — the per-read chain and the broadcast sink;
//   • `rebind()`, which re-runs all of that for `abide dev`'s in-place config reload;
//   • the boot-time posture warnings (`APP_URL`, `NODE_ENV`), the health clock and the log feed;
//   • the WebSocket half of the mux — `open`/`message`/`close` and the per-connection subscription state.
//     The UPGRADE is the pipeline's (it has to run the global chain first); what a live socket then does
//     is transport, and it has no request.

import { provideHealthSource } from '../../shared/internal/healthSource.ts'
import { logFeed } from '../../shared/internal/logFeed.ts'
import { MUX_UPSTREAM } from '../../shared/internal/MUX_UPSTREAM.ts'
import {
    type MemoFrame,
    memoChannelName,
    publishMemoFrame,
} from '../../shared/internal/memoChannels.ts'
import { rpcMemoPolicy } from '../../shared/internal/rpcMemoPolicy.ts'
import { log } from '../../shared/log.ts'
import type { AppConfig } from './appConfig.ts'
import { unrecognizedNodeEnv } from './auth.ts'
import type { SocketConnectionData } from './channelAuth.ts'
import { provideDefaultAgentSurface } from './defaultAgentSurface.ts'
import { deriveRouterPolicy, handleRequest, type RouterPolicy } from './handleRequest.ts'
import { isProd } from './isProd.ts'
import { logFeedSettings } from './logFeedSettings.ts'
import type { Rpc } from './makeRpc.ts'
import { rebindRegistryDerivations } from './registryDerivation.ts'
import { bindRpcChains } from './rpcChain.ts'
import { rpcTools } from './rpcTools.ts'
import { type SocketConnection, wsPublish, wsSubscribe, wsUnsubscribe } from './socketMux.ts'

export interface App {
    server: Bun.Server<undefined>
    origin: string
    stop(): Promise<void>
    // RE-DERIVE every per-surface binding from the CURRENT `config` — for `abide dev`, which mutates the
    // config in place on each rebuild (fresh route callables, a fresh global middleware array, a re-synced
    // socket registry) and cannot otherwise tell the app that its authorization is now derived from a
    // previous build. Not a lifecycle hook: a served app never calls it.
    rebind(): void
}

export function createApp(config: AppConfig = {}): App {
    // Per-surface static policy, derived once per BOOT rather than per request. `crossOrigin` and
    // `middleware` live on an immutable options object, so normalizing the CORS config and merging the
    // global + per-rpc middleware lists on every request re-derived a constant — and the merge also
    // allocated a fresh spread array each time. Only the final `compose` stays per-request: its inner
    // `next` closes over that request's scope.
    //
    // The derivation itself lives with the pipeline that reads it (`deriveRouterPolicy`); what stays here
    // is the two REGISTRY BINDINGS beside it, which mutate route callables rather than deriving a lookup.
    let policy: RouterPolicy = deriveRouterPolicy(config)

    // EVERY PER-SURFACE DERIVATION, in one place that can be run AGAIN. There were four, each its own loop
    // over a `routes`/`sockets`/`globalMiddleware` local captured at boot: the route policy above, the
    // per-read middleware chain, the `(rpc,args)` broadcast sink, and the socket policy. A dev rebuild
    // invalidates all four at once — it reassigns `config.routes`, `config.middleware` and re-syncs the
    // sockets — and re-derived none of them, so the app kept serving the first build's authorization.
    const bindRoutes = (): void => {
        const routes = config.routes ?? {}
        policy = deriveRouterPolicy(config)

        // The OWN rung, for every other door — page SSR, a handler reading a sibling rpc, a cron tick, an
        // `abide run` migration. Shared with those other boots (`rpcChain.ts`) rather than spelled here,
        // because which door built the app must not decide whether a read is authorized.
        bindRpcChains(config)

        // §8 broadcast seam (PR2): bind each SHARED read route's transport-free memo `notify` sink to a
        // publish onto its `(rpc,args)` channel. The route NAME is the `config.routes` key — known only
        // here — so the router is the sole owner of both name and registry; memo/makeRpc stay
        // transport-free. Value-form `publish` carries a `value`; invalidate/refresh do not.
        for (const [name, route] of Object.entries(routes)) {
            const meta = route.__rpc
            // Through the NORMALIZER, not a second reading of the authored option. The inline
            // `memo !== false && memo?.crossRequest === true` this replaces produced the same answer
            // today and was one default away from not doing — `registry.ts` records the same shape
            // going wrong before ("it used to be a second derivation, and it disagreed").
            if (meta.read && rpcMemoPolicy(meta.options.memo, meta.read).crossRequest) {
                // biome-ignore lint/suspicious/noExplicitAny: existential rpc — the route's concrete Args/T are erased here; `unknown` breaks assignability through RpcMeta's invariant Args.
                ;(route as Rpc<any, any>).bindBroadcast((verb, args, value): void => {
                    const frame: MemoFrame = verb === 'publish' ? { verb, value } : { verb }
                    publishMemoFrame(memoChannelName(name, args), frame)
                })
            }
        }
    }
    bindRoutes()

    // RE-bind, which is strictly more than the boot bind: the policy Maps above are re-derived eagerly
    // (they are this closure's own state and nothing else can drop them), and then every LAZY derivation
    // that lives next to the cache it belongs to is invalidated — the page-pattern list, the client
    // bundle, the agent tool surface.
    //
    // The invalidations run HERE and not inside `bindRoutes`, because boot has nothing stale to drop and
    // dropping at boot is not merely wasteful: `abide start` and `createTestApp` build the client BEFORE
    // constructing the app, so a boot-time eviction discarded the build they had just paid for and served
    // 404 for its chunks until something rebuilt it. "Derived state is stale" is a statement about a
    // SECOND derivation, which is what `rebind` names.
    const rebind = (): void => {
        bindRoutes()
        rebindRegistryDerivations(config)
    }

    // AU8.3 / CX8.1: the Origin/Referer CSRF check and the CSWSH WebSocket-upgrade gate both key off
    // `APP_URL`. An unset `APP_URL` is legitimate in dev (and for hand-built/test apps), so those gates
    // fall OPEN rather than block — but in production that silently disables two same-origin defenses.
    // Warn ONCE at boot (root channel → always emitted, even without DEBUG) so the omission is loud.
    if (isProd() && (Bun.env.APP_URL === undefined || Bun.env.APP_URL.length === 0)) {
        log.warn(
            'APP_URL is unset in production — the CSRF Origin/Referer check and the CSWSH WebSocket-upgrade gate are DISABLED (both fall open). Set APP_URL to your public origin to enable them.',
        )
    }
    // AU5/AU8: NODE_ENV is the single production gate (Secure cookie, HSTS, the identity-secret fail-fast).
    // A set-but-unrecognized value (`prod`, `staging`, …) is treated as non-production and silently relaxes
    // all three — warn once so a misconfigured deploy is loud rather than insecure-by-typo.
    const badNodeEnv = unrecognizedNodeEnv()
    if (badNodeEnv !== undefined) {
        log.warn(
            `NODE_ENV="${badNodeEnv}" is not recognized — treating as non-production. The Secure cookie flag, HSTS, and the authenticated identity.set() secret requirement are all OFF. Set NODE_ENV=production to enable the production security posture.`,
        )
    }
    // CO2.4: server bind time — the clock for `/__abide/health`'s `startedAt`/`uptime`. Captured here
    // (not per request) so uptime measures the process, and survives `abide dev`'s in-place config reloads
    // (the router keeps running; createApp is not re-invoked).
    const startedAt = Date.now()

    // The log feed is opt-in and enabled HERE — at bind, not on the first subscribe — because its ring
    // must already be filling when someone runs `logs` in response to a problem. `shared/log.ts` reads
    // only a boolean, so the policy (and the env name) lives on this side and a browser bundle carries
    // neither. `abide run` binds no server and so never enables it: there would be no route to read it.
    const logFeedConfig = logFeedSettings()
    if (logFeedConfig.enabled) logFeed.enable(logFeedConfig.capacity)

    // Per-connection subscription state, keyed by the live WS. The connection's identity + request
    // ride on `ws.data` (SocketConnectionData, resolved at upgrade); this map holds only the live
    // subscription iterators so unsub/close can `return()` them.
    const connections = new WeakMap<Bun.ServerWebSocket<SocketConnectionData>, SocketConnection>()

    const server = Bun.serve<SocketConnectionData>({
        port: config.port ?? 0,
        // Bun's default idle timeout (10s) would kill a byte-idle SSE stream (the socket HTTP face)
        // between messages; raise it to Bun's max (255s). Long-lived streams also emit a heartbeat
        // (server/sse.ts) so they survive intermediary proxies with their own idle windows.
        idleTimeout: 255,
        // THE PIPELINE, by name. `Bun.serve`'s `fetch` is the ADAPTER: it supplies the request, the
        // server and the boot-derived policy this closure owns, and nothing else. Everything the
        // response passes through lives in `handleRequest.ts`, where the stage order is stated once and
        // an exit path can be exercised without an OS port.
        fetch: (request, srv): Promise<Response | undefined> =>
            handleRequest(request, srv, config, policy),
        websocket: {
            open(ws): void {
                connections.set(ws, { subscriptions: new Map() })
            },
            message(ws, raw): void {
                // `args` is only meaningful for an `@rpc:` cache channel (the raw args that must NAME the
                // channel — the args-spoof defense); it is ignored for bare user-socket subscriptions.
                let frame: {
                    t?: unknown
                    name?: unknown
                    args?: unknown
                    msg?: unknown
                    replay?: unknown
                }
                try {
                    frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString())
                } catch {
                    return
                }
                if (frame === null || typeof frame !== 'object') return
                const connection = connections.get(ws)
                if (connection === undefined) return
                if (frame.t === MUX_UPSTREAM.sub)
                    wsSubscribe(
                        ws,
                        connection,
                        frame.name,
                        frame.args,
                        frame.replay,
                        // Read LIVE, not captured at boot. `abide dev`'s `syncSockets` happens to mutate
                        // the registry in place, so a capture stayed correct — but that made a `cli/`
                        // implementation detail load-bearing for a `server/internal/` closure, with
                        // nothing stating it. Reading through costs one property load per frame.
                        config.sockets ?? {},
                        config,
                    )
                else if (frame.t === MUX_UPSTREAM.unsub)
                    wsUnsubscribe(connection, frame.name, frame.args)
                else if (frame.t === MUX_UPSTREAM.pub)
                    void wsPublish(
                        ws,
                        frame.name,
                        frame.args,
                        frame.msg,
                        config.sockets ?? {},
                        config,
                    )
                // An unrecognized frame type is dropped — but LOUDLY, not silently: a drifted discriminant
                // would otherwise fail open (e.g. an ignored `unsub` keeps a stream pumping). Gated channel,
                // so it never spams prod logs unless DEBUG names it.
                else if (frame.t !== undefined)
                    log.channel('abide:socket').warn('dropped unknown mux frame type:', frame.t)
            },
            close(ws): void {
                const connection = connections.get(ws)
                if (connection === undefined) return
                for (const iterator of connection.subscriptions.values()) {
                    void iterator.return?.()
                }
                connection.subscriptions.clear()
                connections.delete(ws)
            },
        },
    })

    const origin = `http://localhost:${server.port}`

    // This process is now serving THIS app, so this is what `agent()` means by "the app's tools"
    // (AG2.2). A thunk, so a process that never calls `agent()` never walks the routes; withdrawn on
    // `stop()`, so a stopped app is not still answering as the default for whatever boots next.
    const withdrawAgentSurface = provideDefaultAgentSurface(() => rpcTools(config, origin), config)

    // …and this is what `health()` means by "the app" (CO2.4): the bind clock plus the app's own hook.
    // Withdrawn on `stop()` by the same rule — a stopped app must not keep answering for its health.
    // A getter, not a captured value: `abide dev` reloads by swapping `config`'s properties in place
    // while this router keeps running, so an `onHealth` read at bind would be the one the app had when
    // the process started and no save would ever replace it.
    const withdrawHealthSource = provideHealthSource({
        startedAt,
        get onHealth() {
            return config.onHealth
        },
    })

    return {
        // Public App surface keeps `Bun.Server<undefined>`; the WS-data generic is internal (see above).
        server: server as unknown as Bun.Server<undefined>,
        origin,
        // The same derivation the boot ran, over whatever `config` now holds, plus the lazy caches the
        // boot deliberately leaves alone. `onHealth` next door solves the same problem with a getter; a
        // policy Map cannot be a getter, so it is re-derived on demand.
        rebind,
        async stop(): Promise<void> {
            withdrawAgentSurface()
            withdrawHealthSource()
            await server.stop(true)
        },
    }
}

// Re-exported so the app-shape types are still reachable from the module that CONSUMES them.
// New code should import them from `./appConfig.ts` directly.
export type { AppConfig, Route } from './appConfig.ts'
