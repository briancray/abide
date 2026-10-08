// SECTION 42 — THE APP OBJECT. What a host, a test or a script holds the app as, and what both
// commands that serve are built on: `abide start` over what the build wrote and `abide dev` over
// what its worker compiled. Where the parts come from is the caller's (`sources`); what is done with
// them — the hooks, the onion, the one scope a request is answered in — is here, once.
//
// NOT HERE YET: 42.11's ending of every live stream and timer. Its sockets are closed, and the
// requests in flight drained, in `stopOnce`.

import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { resolve } from 'node:path' // bun exposes no path helpers of its own
import { FAILURE_STATUS_TEXT } from '#shared/FAILURE_STATUS_TEXT.ts'
import { namedLogger } from '#shared/log.ts'
import { compose } from '#shared/Middleware.ts'
import { MOUNT, unmounted } from '#shared/mount.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'
import {
    type AppSources,
    answerRequest,
    type LoadedSources,
} from './answerRequest.ts'
import { Mux, type MuxConnection } from './answerSocket.ts'
import { buildDirectory } from './buildDirectory.ts'
import { APP_PACKAGE, type AppPackage, config, packageUnder } from './config.ts'
import { McpSurface } from './generatedSurfaces.ts'
import { HOOKS, reportUnexpected } from './hooks.ts'
import { installServer } from './installServer.ts'
import { admitsMux, upgraded } from './muxUpgrade.ts'
import { plainAnswer } from './plainAnswer.ts'
import {
    type AnsweringApp,
    applyWritten,
    currentRequestScope,
    inReleasedScope,
    LISTENING,
    rungsTook,
    serverTiming,
} from './requestScope.ts'
import { testBuild } from './testBuild.ts'
import { traceResponse } from './trace.ts'

// 28.8 — one line per request.
const REQUEST_LOG = namedLogger('abide:request')

/** The app object: what a host, a test or a script holds the app as. */
export interface App {
    fetch(request: Request): Promise<Response>
    run<Result>(
        fn: () => Result | Promise<Result>,
        options?: { request?: Request },
    ): Promise<Result>
    listen(options?: { port?: number; unix?: string }): Promise<void>
    stop(): Promise<void>
    [Symbol.asyncDispose](): Promise<void>
}

// 37.2 — the two shapes `default` may take.
type OwnRoute =
    | ((
          request: Request,
          server: Bun.Server<unknown> | undefined,
      ) => Response | undefined | Promise<Response | undefined>)
    | {
          fetch: (
              request: Request,
              server: Bun.Server<unknown> | undefined,
          ) => unknown
      }

/**
 * The app this process was started in, booted off what `abide build` left beside it.
 *
 * 42.1 — found where the CLI finds it (38.26), and booted off the build (38.28).
 */
export async function createApp(): Promise<App> {
    const root = appRoot(undefined)
    if (root === undefined)
        throw new Error(
            `abide: createApp found no app. Looked for ui/ in ${process.cwd()} and in ${resolve('src')}.`,
        )
    // 42.16 — under `bun test` the app is built for its sources as they stand rather than read off
    // whatever `abide build` last left, which a test run would otherwise need first and could find
    // stale.
    const out =
        process.env.NODE_ENV === 'test'
            ? await testBuild(root)
            : buildDirectory(root)
    const { loadBuild } = await import('./serveBuild.ts')
    return bootApp(originUnder(root), () => loadBuild({ root, out }))
}

/**
 * The directory `ui/` sits under, or `undefined` where none is found.
 *
 * 38.26 and 38.27 — `undefined` is a refusal and not a guess.
 */
export function appRoot(given: string | undefined): string | undefined {
    if (given !== undefined) return resolve(given)
    const here = process.cwd()
    if (existsSync(`${here}/ui`)) return here
    const under = resolve('src')
    return existsSync(`${under}/ui`) ? under : undefined
}

/**
 * What an app is booted as besides its sources: its hooks module and its `package.json`.
 *
 * The two things `bootApp` reads before the boot and not through it. Found under the source root
 * for an app on disk (`originUnder`), and handed over by a compiled app, which has no root to look
 * under.
 */
export type AppOrigin = {
    /** The import of `src/server/app.ts`, where the app has one. 37.1. */
    hooks: (() => Promise<{ default?: OwnRoute }>) | undefined
    /** 27.3's name and version. */
    package: AppPackage
}

/** The path of the app's hooks module under its source root, where it has one. 37.1. */
export function hooksModuleUnder(root: string): string | undefined {
    const hooksModule = `${root}/server/app.ts`
    return existsSync(hooksModule) ? hooksModule : undefined
}

/** The `AppOrigin` of an app on disk, found under its source root. */
export function originUnder(root: string): AppOrigin {
    const hooksModule = hooksModuleUnder(root)
    return {
        hooks:
            hooksModule === undefined
                ? undefined
                : () => import(Bun.pathToFileURL(hooksModule).href),
        package: packageUnder(root),
    }
}

/** An `App` booted over the sources `load` supplies, inside the app's `onStart` hooks. */
export async function bootApp(
    origin: AppOrigin,
    load: () => Promise<LoadedSources>,
): Promise<App> {
    installServer()
    // 37.1 — OPTIONAL, and imported for what it CALLS: every hook it runs is filed by the time the
    // import settles.
    const own =
        origin.hooks === undefined
            ? undefined
            : ((await origin.hooks()).default ?? undefined)

    // 37.4 — THE BOOT, INSIDE `onStart`. 37.6 — a throw out of a hook or out of the boot rejects
    // `createApp`, and nothing is served.
    //
    // 42.2 — THE CONFIGURATION IS READ AS PART OF THE BOOT, so a configuration that does not resolve
    // is a boot that fails rather than a first request that does.
    APP_PACKAGE.current = origin.package
    let sources: LoadedSources | undefined
    await compose(HOOKS.starts, async () => {
        config.invalidate()
        await config
        sources = await load()
    })(undefined)
    if (sources === undefined)
        throw new Error(
            'abide: an onStart hook returned without calling start(), so the app never booted. RULEBOOK 37.4.',
        )
    const booted: AppSources = {
        ...sources,
        own: own === undefined ? undefined : ownRoute(own),
    }

    // 16.15, 37.3 — THE APP LANE'S ONION, composed once over the whole request path. 21.20 — the
    // centre takes its own time back out of what `fetch` counts for the whole onion.
    const answer = compose(HOOKS.rungs, async ({ request }) => {
        const began = performance.now()
        const answered = await answerRequest(booted, request)
        if (HOOKS.rungs.length > 0) rungsTook(began - performance.now())
        return answered
    })

    // The mux `listen` runs over this app's tables. `abide dev` holds its sockets in another process,
    // and its worker runs one over the same tables (`devWorker`).
    let mux: Mux | undefined
    let inFlight = 0
    let drained: (() => void) | undefined
    let stopping = false
    let bound: Bun.Server<unknown> | undefined

    const run = async <Result>(
        fn: () => Result | Promise<Result>,
        options?: { request?: Request },
    ): Promise<Result> =>
        inReleasedScope(options?.request, async () => await fn(), answering)

    const fetch = async (given: Request): Promise<Response> => {
        if (stopping) return plainAnswer('the app is stopping', 503)
        const request = belowMount(given)
        if (request instanceof Response) return request
        inFlight += 1
        const started = performance.now()
        try {
            // 42.6 — `run`, with dispatch over it — and the headers every answer carries stamped
            // inside it, where the trace the request was answered under is still the current one.
            // 16.23 — the scope keeps `given` too, the one request bun will raise a timeout on.
            return await inReleasedScope(
                request,
                async () => {
                    let answered: Response
                    try {
                        answered = await answer({ request })
                        if (HOOKS.rungs.length > 0)
                            rungsTook(performance.now() - started)
                    } catch (thrown) {
                        reportUnexpected(thrown)
                        answered = plainAnswer('internal server error', 500)
                    }
                    const stamped = stamp(answered)
                    // 28.7 — a closed namespace does not pay for the line it would have written.
                    if (REQUEST_LOG.enabled())
                        REQUEST_LOG.debug(
                            request.method,
                            new URL(request.url).pathname,
                            stamped.status,
                            `${(performance.now() - started).toFixed(1)}ms`,
                        )
                    return stamped
                },
                answering,
                given,
            )
        } finally {
            inFlight -= 1
            if (inFlight === 0) drained?.()
        }
    }

    // 20.10, 42.12 — THE APP'S MCP SURFACE CALLS THROUGH ITS OWN `fetch`, whichever scope asks.
    const answering: AnsweringApp = {
        answer: fetch,
        mcp: new McpSurface(booted.handlers, fetch),
    }

    // 16.43, 42.12 — A `raw` CALL MADE ON THIS SERVER IS ANSWERED IN PROCESS, by the app answering the
    // request it was made in; only a call made outside every request falls to the app built last.
    RPC_SERVER.raw = (request) =>
        (currentRequestScope()?.app?.answer ?? fetch)(request)

    // 42.15 — ONE STOP, however many ask for it: a signal landing while the shell's `exit` is already
    // stopping the app is answered with that stop, and `onStop` runs once.
    let stopped: Promise<void> | undefined
    function stop(): Promise<void> {
        stopped ??= stopOnce()
        return stopped
    }

    // 42.10 — stop accepting, drain, and only then the teardown `onStop` wraps (37.4).
    async function stopOnce(): Promise<void> {
        stopping = true
        // 42.11 — every open socket is closed rather than left to the process's exit.
        mux?.closeAll(1001, 'the app is stopping')
        await bound?.stop()
        if (inFlight > 0)
            await new Promise<void>((done) => {
                drained = done
            })
        if (LISTENING.server === bound) LISTENING.server = undefined
        bound = undefined
        await compose(HOOKS.stops, async () => {})(undefined)
    }

    return {
        fetch,
        run,
        // 42.9 — the socket, and what `server` hands back from then on.
        async listen(options) {
            const port = options?.port
            const opened = new Mux(booted.sockets, booted.handlers, answering)
            mux = opened
            // The upgrade carries its request to `open`, where the connection is made over the socket.
            type Upgraded = {
                request: Request
                connection: MuxConnection | undefined
            }
            const server = Bun.serve<Upgraded>({
                ...(options?.unix !== undefined
                    ? { unix: options.unix }
                    : port !== undefined
                      ? { port }
                      : {}),
                // 16.58 — THE CEILING IS THE HANDLER'S, and bun's own 128 MB would refuse a body
                // before one that declared none could accept it.
                maxRequestBodySize: Number.MAX_SAFE_INTEGER,
                // 18.2, 37.3 — THE ONE MUX, upgraded where the app lane admitted it.
                fetch: async (request, server) => {
                    const answered = await fetch(request)
                    return admitsMux(request, answered, booted)
                        ? upgraded(server, request, {
                              request,
                              connection: undefined,
                          })
                        : answered
                },
                websocket: {
                    open(ws) {
                        ws.data.connection = opened.connect(ws.data.request, ws)
                    },
                    message(ws, raw) {
                        return ws.data.connection?.message(raw)
                    },
                    close(ws) {
                        ws.data.connection?.close()
                    },
                },
            })
            bound = server as unknown as Bun.Server<unknown>
            LISTENING.server = bound
        },
        stop,
        // 42.14.
        [Symbol.asyncDispose]: stop,
    }
}

/**
 * The answer with the headers every answer carries, and what was written through `response`.
 *
 * 21.1, 21.2 — ON EVERY ANSWER, a refusal and a 404 included. A `Response` whose headers are
 * immutable — one a handler got from `fetch` and returned — is copied rather than written to.
 *
 * 22.9 — AND WHAT WAS WRITTEN THROUGH `response`, laid over every answer here and nowhere else: a
 * lane builds its answer at the written status and leaves the headers to this.
 */
function stamp(answered: Response): Response {
    let stamped = answered
    try {
        stamped.headers.set('x-content-type-options', 'nosniff')
    } catch {
        stamped = new Response(answered.body, answered)
        stamped.headers.set('x-content-type-options', 'nosniff')
    }
    // 21.10 — gathered before what was written through `response`, which overrides it.
    const timing = serverTiming()
    if (timing !== undefined) stamped.headers.set('server-timing', timing)
    const written = applyWritten(stamped.headers)
    const status = written !== 200 ? written : stamped.status
    // 17.8 — a failure nobody named a reason for is given its registered one.
    const statusText =
        stamped.statusText === '' && status >= 400
            ? (FAILURE_STATUS_TEXT[status] ?? '')
            : stamped.statusText
    if (status !== stamped.status || statusText !== stamped.statusText)
        stamped = new Response(stamped.body, {
            status,
            statusText,
            headers: stamped.headers,
        })
    const traced = traceResponse()
    if (traced !== undefined) stamped.headers.set('traceresponse', traced)
    return stamped
}

/**
 * The request with the mount taken off its address, where it is under the mount — or the redirect
 * to the mount's root, where it asked for the mount with no `/` after it.
 *
 * 16.11 — A REQUEST UNDER THE MOUNT IS ANSWERED AS THE ADDRESS BELOW IT; one that is not — a proxy
 * that already took the prefix off — is answered as it came.
 *
 * THE MOUNT'S ROOT IS `/docs/`, as `url('/')` writes it. A document answered at `/docs` resolves a
 * relative address against `/`, which is outside the app, so the bare mount is sent to the root a
 * relative address resolves under.
 */
function belowMount(request: Request): Request | Response {
    const mount = MOUNT.current()
    if (mount === '') return request
    const url = new URL(request.url)
    // A PATH RATHER THAN A URL: the origin this request names is the one it reached, which behind
    // a proxy is not the one the browser asked.
    if (url.pathname === mount)
        return new Response(null, {
            status: 308,
            headers: { location: `${mount}/${url.search}` },
        })
    const below = unmounted(url.pathname)
    if (below === undefined || below === url.pathname) return request
    url.pathname = below
    return new Request(url, request)
}

function ownRoute(
    own: OwnRoute,
): (request: Request) => Promise<Response | undefined> {
    const answer = typeof own === 'function' ? own : own.fetch.bind(own)
    return async (request) => {
        const answered = await answer(request, LISTENING.server)
        return answered instanceof Response ? answered : undefined
    }
}
