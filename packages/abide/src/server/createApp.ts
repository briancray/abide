// SECTION 42 — THE APP OBJECT. What a host, a test or a script holds the app as, and what both
// commands that serve are built on: `abide start` over what the build wrote and `abide dev` over
// what its worker compiled. Where the parts come from is the caller's (`sources`); what is done with
// them — the hooks, the onion, the one scope a request is answered in — is here, once.

import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { resolve } from 'node:path' // bun exposes no path helpers of its own

import { FAILURE_STATUS_TEXT } from '#shared/FAILURE_STATUS_TEXT.ts'
import { framingOf } from '#shared/framing.ts'
import { IN_PROCESS_ORIGIN } from '#shared/IN_PROCESS_ORIGIN.ts'
import { namedLogger } from '#shared/log.ts'
import { LONGEST_DELAY } from '#shared/LONGEST_DELAY.ts'
import { compose } from '#shared/Middleware.ts'
import { MOUNT, unmounted } from '#shared/mount.ts'
import { PRINCIPAL_HEADER } from '#shared/PRINCIPAL_HEADER.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'

import { servedTable } from './abideModules.ts'
import { answerRequest, type AppSources } from './answerRequest.ts'
import type { Mount } from './answerRpc.ts'
import { Mux, type MuxConnection } from './answerSocket.ts'
import { appDirectories } from './appDirectories.ts'
import { holdsApp } from './appTree.ts'
import { buildDirectory } from './buildDirectory.ts'
import {
    APP_PACKAGE,
    type AppPackage,
    config,
    packageUnder,
    positiveSetting,
} from './config.ts'
import { McpSurface } from './generatedSurfaces.ts'
import { HOOKS, inOrder, reportUnexpected, rootRungs } from './hooks.ts'
import { IDLE_TIMEOUT_SECONDS } from './IDLE_TIMEOUT_SECONDS.ts'
import { installServer } from './installServer.ts'
import { admitsMux, muxSocketOptions, upgraded } from './muxUpgrade.ts'
import { plainAnswer } from './plainAnswer.ts'
import { presumePrincipal } from './principal.ts'
import { realOrAsGiven } from './realOrAsGiven.ts'
import {
    type AnsweringApp,
    applyWritten,
    currentRequestScope,
    holdScope,
    inReleasedScope,
    LISTENING,
    rungsTook,
    serverTiming,
} from './requestScope.ts'
import { heldBody } from './streamEvent.ts'
import { testBuild } from './testBuild.ts'
import { traceResponse } from './trace.ts'

// 28.8 — one line per request.
const REQUEST_LOG = namedLogger('abide:request')

// 42.18 — HALF OF `docker stop`'s TEN-SECOND GRACE, the shortest a common supervisor gives before its
// `SIGKILL`: the other half is `onStop`'s, so the teardown runs before the kill rather than being cut
// by it.
const STOP_TIMEOUT = 5000

/** The app object: what a host, a test or a script holds the app as. */
export interface App {
    fetch(request: Request): Promise<Response>
    run<Result>(
        fn: () => Result | Promise<Result>,
        options?: { request?: Request; principal?: Record<string, unknown> },
    ): Promise<Result>
    listen(options?: {
        port?: number
        hostname?: string
        unix?: string
    }): Promise<void>
    stop(): Promise<void>
    [Symbol.asyncDispose](): Promise<void>
}

/**
 * The app this process was started in, booted off what `abide build` left beside it.
 *
 * 42.1 — found where the CLI finds it (38.25), and booted off the build (38.27).
 */
export async function createApp(): Promise<App> {
    const root = appRoot(undefined)
    const app = await appOnDisk(
        root === undefined ? undefined : { root, out: buildDirectory(root) },
        (root) => servedBuild(root),
    ).boot()
    if (typeof app === 'string')
        throw new Error(`abide: createApp found ${app}`)
    return app
}

/**
 * One app, as one invocation means it: FOUND ONCE, and everything a command derives — the banner's
 * identity, the shell's handler table, the boot — read off this rather than found again from where
 * the process happens to stand. An app on disk (`appOnDisk`), or the one an executable holds.
 */
export type AppHandle = {
    /** 27.3's name and version: the banner's, and what a script `run` resolves its configuration with. */
    package: AppPackage
    /**
     * The handler table of a build already there, NEVER ONE MADE FOR THE ASKING: `call` and the
     * shell are aimed at a running app (38.7), which this tree may not even be. Empty where none.
     */
    handlers: () => Promise<Mount[]>
    /** The app's build made this process's, and booted — or why there is nothing to boot. */
    boot: () => Promise<App | string>
}

/** Why there is no app where none was named: where 38.25 looked. 38.26. */
export function noAppHere(): string {
    return `no app here. Looked for a .abide under ${resolve('src')}, or under ${process.cwd()} where it has no src.`
}

/**
 * The app on disk at `found` — its source root and build directory, both absolute — or the
 * refusal where nothing was found. `built` makes its build this process's (`serveBuild`, which
 * builds one nobody built — 38.100) and answers the directory it is in, or `undefined` where
 * nothing under the root builds.
 */
export function appOnDisk(
    found: { root: string; out: string } | undefined,
    built: (root: string, out: string) => Promise<string | undefined>,
): AppHandle {
    if (found === undefined)
        return {
            package: packageUnder(process.cwd()),
            handlers: async () => [],
            boot: async () => noAppHere(),
        }
    const { root, out } = found
    const origin = originUnder(root)
    return {
        package: origin.package,
        handlers: async () => {
            const { serveBuild } = await import('./serveBuild.ts')
            if (!(await serveBuild(root, out, async () => undefined))) return []
            return (await servedTable(root)).handlers
        },
        boot: async () => {
            const served = await built(root, out)
            if (served === undefined) return `nothing under ${root} to build.`
            const { loadBuild } = await import('./serveBuild.ts')
            return bootApp(origin, () => loadBuild({ root, out: served }))
        },
    }
}

/**
 * The build of the app under `root`, served to this process's imports — or `undefined` where
 * nothing under it builds. `fresh` builds it for its sources as they stand.
 *
 * 42.16 — under `bun test` the app is built for its sources as they stand rather than read off
 * whatever `abide build` last left, which a test run would otherwise need first and could find
 * stale. One answer for `createApp` and the test preload (38.109), so a test that boots the app
 * reuses the build its imports were served from.
 */
export async function servedBuild(
    root: string,
    fresh = process.env.NODE_ENV === 'test',
): Promise<string | undefined> {
    const out = fresh ? await testBuild(root) : buildDirectory(root)
    const { serveBuild } = await import('./serveBuild.ts')
    return (await serveBuild(root, out)) ? out : undefined
}

/**
 * The app's root — `--root`, else `src` where the working directory holds one, else the working
 * directory — or `undefined` where it is no app's.
 *
 * 38.25 and 38.26 — `undefined` is a refusal and not a guess. An app's root is in a package — it or
 * the directory above it holds the `package.json` (`appDirectories`) — and holds a `.abide`
 * file; the package is asked first, so a command run from `/` answers at once rather than
 * walking the disk.
 *
 * ITS REAL PATH, as the bundler and the resolver name every file under it: an app under `/tmp` is
 * `/private/tmp` to both, and one spelling here is one fewer at every reader downstream.
 */
export function appRoot(given: string | undefined): string | undefined {
    if (given !== undefined) return realOrAsGiven(resolve(given))
    const under = resolve('src')
    const root = realOrAsGiven(existsSync(under) ? under : process.cwd())
    let packaged = false
    for (const directory of appDirectories(root))
        packaged ||= existsSync(`${directory}/package.json`)
    return packaged && holdsApp(root) ? root : undefined
}

/**
 * What an app is booted as besides its sources: its hooks module and its `package.json`.
 *
 * The two things `bootApp` reads before the boot and not through it. Found under the source root
 * for an app on disk (`originUnder`), and handed over by a compiled app, which has no root to look
 * under.
 */
export type AppOrigin = {
    /**
     * Imports every module holding a `<script server>`, where the app has one. 37.1.
     *
     * Imported for what each CALLS: every hook it runs is filed by the time the import settles.
     */
    hooks: (() => Promise<unknown>) | undefined
    /** 27.3's name and version. */
    package: AppPackage
}

/**
 * The `AppOrigin` of an app on disk: its package under `root`, and its server blocks, out of the
 * compilation this process serves (`serveCompilation`) — the build's, or `abide dev`'s.
 */
export function originUnder(root: string): AppOrigin {
    return {
        hooks: async () => {
            const table = await servedTable(root)
            await Promise.all(table.servers.map((load) => load()))
        },
        package: packageUnder(root),
    }
}

/**
 * An `App` as a command boots it: with the mux over its tables, which `listen` opens and `abide dev`'s
 * worker opens in its stead — one `AnsweringApp`, and one MCP surface, per app either way.
 */
export type BootedApp = App & { openMux(): Mux }

/**
 * Enters the app as this process's server — every slot `#shared` leaves for one filled, the app's
 * identity set, every server block imported — and re-resolves the configuration: the one preamble
 * `bootApp`, a script `run` and the desktop launcher each start with.
 *
 * 37.1 — EVERY SERVER BLOCK, imported for what it CALLS: every hook it runs is filed by the time the
 * import settles, which is before `onStart` is composed around a boot. 38.57 — RE-RESOLVED: a module
 * this process loaded first may already have read the configuration, under no identity.
 */
export async function enterApp(origin: AppOrigin): Promise<void> {
    installServer()
    APP_PACKAGE.current = origin.package
    if (origin.hooks !== undefined) await origin.hooks()
    config.invalidate()
}

/** An `App` booted over the sources `load` supplies, inside the app's `onStart` hooks. */
export async function bootApp(
    origin: AppOrigin,
    load: () => Promise<AppSources>,
): Promise<BootedApp> {
    await enterApp(origin)
    return bootEntered(load)
}

/**
 * `bootApp` in a process `enterApp` already entered the app in: the desktop launcher's, which enters
 * once for the hooks its own page reads and boots again on every start.
 */
export async function bootEntered(
    load: () => Promise<AppSources>,
): Promise<BootedApp> {
    // 37.4 — THE BOOT, INSIDE `onStart`. 37.6 — a throw out of a hook or out of the boot rejects
    // `createApp`, and nothing is served.
    //
    // 42.2 — THE CONFIGURATION IS READ AS PART OF THE BOOT, so a configuration that does not resolve
    // is a boot that fails rather than a first request that does.
    let sources: AppSources | undefined
    await compose(inOrder(HOOKS.starts), async () => {
        config.invalidate()
        await config
        sources = await load()
    })(undefined)
    if (sources === undefined)
        throw new Error(
            'abide: an onStart hook returned without calling start(), so the app never booted. RULEBOOK 37.4.',
        )
    const booted = sources

    // 16.14, 37.3 — THE APP LANE'S ONION, composed once over the whole request path: the root
    // route's rungs, the ones below it running after routing (37.2, `answerRequest`). 21.20 — the
    // center takes its own time back out of what `fetch` counts for the whole onion.
    const rungs = rootRungs()
    const answer = compose(rungs, async ({ request }) => {
        const began = performance.now()
        const answered = await answerRequest(booted, request)
        if (rungs.length > 0) rungsTook(began - performance.now())
        return answered
    })

    // The mux over this app's tables (`openMux`): `listen` opens it, or `abide dev`'s worker, whose
    // sockets the listener holds in another process.
    let mux: Mux | undefined
    let inFlight = 0
    let drained: (() => void) | undefined
    let stopping = false
    let bound: Bun.Server<unknown> | undefined

    const run: App['run'] = async (fn, options) => {
        const claims = options?.principal
        // 42.19 — a principal is a request's, so one given alone is given a request to be.
        const request =
            options?.request ??
            (claims === undefined ? undefined : new Request(IN_PROCESS_ORIGIN))
        return inReleasedScope(
            request,
            async () => {
                if (claims !== undefined) presumePrincipal(claims)
                return await fn()
            },
            answering,
        )
    }

    const fetch = async (given: Request): Promise<Response> => {
        if (stopping) return plainAnswer('the app is stopping', 503)
        const request = belowMount(given)
        if (request instanceof Response) return request
        inFlight += 1
        const started = performance.now()
        try {
            // 42.6 — `run`, with dispatch over it — and the headers every answer carries stamped
            // inside it, where the trace the request was answered under is still the current one.
            // 16.23 — the scope keeps `given` too, the one request bun will set a timeout on.
            return await inReleasedScope(
                request,
                async () => {
                    let answered: Response
                    try {
                        answered = await answer({ request })
                        if (rungs.length > 0)
                            rungsTook(performance.now() - started)
                    } catch (thrown) {
                        reportUnexpected(thrown)
                        answered = plainAnswer('internal server error', 500)
                    }
                    const stamped = beating(stamp(answered, booted.offline))
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
        held: new Set(),
    }

    // 16.42, 42.12 — A `raw` CALL MADE ON THIS SERVER IS ANSWERED IN PROCESS, by the app answering the
    // request it was made in; only a call made outside every request falls to the app built last.
    const answerRaw = (request: Request): Promise<Response> =>
        (currentRequestScope()?.app?.answer ?? fetch)(request)
    RPC_SERVER.raw = answerRaw

    const openMux = (): Mux => {
        mux = new Mux(booted.handlers, answering)
        return mux
    }

    // 42.15 — ONE STOP, however many ask for it: a signal landing while the shell's `exit` is already
    // stopping the app is answered with that stop, and `onStop` runs once.
    let stopped: Promise<void> | undefined
    function stop(): Promise<void> {
        stopped ??= stopOnce()
        return stopped
    }

    // 42.11 — every streamed body still being written and every seed entry still standing, ended.
    // A copy, because each end unfiles itself.
    const endHeld = (): void => {
        for (const end of [...answering.held]) end()
    }

    // 42.10 — stop accepting, drain, and only then the teardown `onStop` wraps (37.4).
    async function stopOnce(): Promise<void> {
        stopping = true
        // 42.11 — every open socket is closed rather than left to the process's exit, and every
        // stream ended, which a listener's stop otherwise waits on for as long as it streams.
        mux?.closeAll(1001, 'the app is stopping')
        endHeld()
        const drain = (async () => {
            await bound?.stop()
            if (inFlight > 0)
                await new Promise<void>((done) => {
                    drained = done
                })
            return true
        })()
        // 42.17, 42.18 — THE DRAIN HAS A DEADLINE: past it, every connection still answering is
        // closed and `onStop` runs without waiting on the rest. A request `App.fetch` was handed with
        // no socket bound has no connection to close, and is only no longer waited on.
        let deadline: ReturnType<typeof setTimeout> | undefined
        const finished = await Promise.race([
            drain,
            new Promise<false>((done) => {
                deadline = setTimeout(
                    () => done(false),
                    Math.min(
                        positiveSetting('ABIDE_STOP_TIMEOUT', STOP_TIMEOUT),
                        LONGEST_DELAY,
                    ),
                )
            }),
        ])
        clearTimeout(deadline)
        if (!finished) await bound?.stop(true)
        // What the requests drained here left behind them.
        endHeld()
        if (LISTENING.server === bound) LISTENING.server = undefined
        // 16.42 — a stopped app answers no `raw` call made outside every request.
        if (RPC_SERVER.raw === answerRaw) RPC_SERVER.raw = null
        bound = undefined
        await compose(inOrder(HOOKS.stops), async () => {})(undefined)
    }

    return {
        fetch,
        run,
        // 42.9 — the socket, and what `server` hands back from then on.
        async listen(options) {
            const port = options?.port
            const opened = openMux()
            // The upgrade carries its request to `open`, where the connection is made over the socket.
            type Upgraded = {
                request: Request
                connection: MuxConnection | undefined
            }
            const server = Bun.serve<Upgraded>({
                ...(options?.unix !== undefined
                    ? { unix: options.unix }
                    : {
                          // 16.56 — the bound a request received whole lifts and its answer puts
                          // back (16.23). A unix socket takes bun's own.
                          idleTimeout: IDLE_TIMEOUT_SECONDS,
                          ...(port === undefined ? {} : { port }),
                          ...(options?.hostname === undefined
                              ? {}
                              : { hostname: options.hostname }),
                      }),
                // 16.54 — THE CEILING IS THE HANDLER'S, and bun's own 128 MB would refuse a body
                // before one that declared none could accept it.
                maxRequestBodySize: Number.MAX_SAFE_INTEGER,
                // 18.1, 37.3 — THE ONE MUX, upgraded where the app lane admitted it.
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
                    ...muxSocketOptions(),
                    open(socket) {
                        socket.data.connection = opened.connect(
                            socket.data.request,
                            socket,
                        )
                    },
                    message(socket, raw) {
                        return socket.data.connection?.message(raw)
                    },
                    close(socket) {
                        socket.data.connection?.close()
                    },
                },
            })
            bound = server as unknown as Bun.Server<unknown>
            LISTENING.server = bound
        },
        openMux,
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
 *
 * 21.24 — and where the worker keeps answers (`offline`), a sign-in or a sign-out has the browser's
 * own cache drop what it kept for the caller before, as the worker drops its copies (45.7).
 */
function stamp(answered: Response, offline: boolean): Response {
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
    if (offline && stamped.headers.has(PRINCIPAL_HEADER))
        stamped.headers.set('clear-site-data', '"cache"')
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
 * `answered`, beating where it is an event stream, and holding its request's scope until it ends.
 *
 * 16.57 — EVERY `text/event-stream`, whoever wrote it: an sse body, a followed value, a pairing's
 * stream, a `Response` a handler built itself. 16.23 — and the hold is what keeps the last of those
 * from being reaped once `fetch` returns, where nothing else outlives it.
 */
function beating(answered: Response): Response {
    // The type first: reading `body` turns a string answer into a stream.
    if (
        framingOf(answered.headers.get('content-type')) !== 'sse' ||
        answered.body === null
    )
        return answered
    return new Response(heldBody(answered.body, holdScope(), true), answered)
}

/**
 * The request with the mount taken off its address, where it is under the mount — or the redirect
 * to the mount's root, where it asked for the mount with a `/` after it.
 *
 * 16.10 — A REQUEST UNDER THE MOUNT IS ANSWERED AS THE ADDRESS BELOW IT; one that is not — a proxy
 * that already took the prefix off — is answered as it came.
 *
 * 19.17 — THE MOUNT'S ROOT IS `/docs`, as `url('/')` writes it, and `/docs/` is sent there so the
 * root has one address. Every address abide writes is absolute under the mount, so none resolves
 * against the page's.
 */
function belowMount(request: Request): Request | Response {
    const mount = MOUNT.current()
    if (mount === '') return request
    const url = new URL(request.url)
    // A PATH RATHER THAN A URL: the origin this request names is the one it reached, which behind
    // a proxy is not the one the browser asked.
    if (url.pathname === `${mount}/`)
        return new Response(null, {
            status: 308,
            headers: { location: `${mount}${url.search}` },
        })
    const below = unmounted(url.pathname)
    if (below === undefined || below === url.pathname) return request
    url.pathname = below
    return new Request(url, request)
}
