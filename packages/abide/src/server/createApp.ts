// SECTION 42 — THE APP OBJECT. What a host, a test or a script holds the app as, and what both
// commands that serve are built on: `abide start` over what the build wrote and `abide dev` over
// what its worker compiled. Where the parts come from is the caller's (`sources`); what is done with
// them — the hooks, the onion, the one scope a request is answered in — is here, once.
//
// NOT HERE YET: 42.11's ending of every live stream and socket and timer, of which only the drain
// is done.

import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { dirname, resolve } from 'node:path' // bun exposes no path helpers of its own

import { namedLogger } from '#shared/log.ts'
import { compose } from '#shared/Middleware.ts'
import { MOUNT, unmounted } from '#shared/mount.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'
import { SOCKET_ADDRESS } from '#shared/SOCKET_ADDRESS.ts'
import {
    type AppSources,
    answerRequest,
    type LoadedSources,
} from './answerRequest.ts'
import {
    type Connection,
    connectionOf,
    socketHandlers,
} from './answerSocket.ts'
import { CONFIG_ROOT, config } from './config.ts'
import { HOOKS, reportUnexpected } from './hooks.ts'
import { applyWritten, inScope, LISTENING } from './requestScope.ts'
import { traceResponse } from './trace.ts'

// 28.8 — one line per request.
const REQUEST_LOG = namedLogger('abide:request')

export interface App {
    fetch(request: Request): Promise<Response>
    run<Result>(
        fn: () => Result | Promise<Result>,
        options?: { request?: Request },
    ): Promise<Result>
    listen(options?: { port?: number; unix?: string }): Promise<void>
    stop(): Promise<void>
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

// 42.1 — `createApp()` for the app this process was started in: found where the CLI finds it
// (38.26), and booted off what `abide build` left beside it (38.28).
export async function createApp(): Promise<App> {
    const root = appRoot(undefined)
    if (root === undefined)
        throw new Error(
            `abide: createApp found no app. Looked for ui/ in ${process.cwd()} and in ${resolve('src')}.`,
        )
    const out = buildDirectory(root)
    if (!existsSync(`${out}/server.ts`))
        throw new Error(
            `abide: createApp found no build at ${out}. Run \`abide build\` first.`,
        )
    const { loadBuild } = await import('./serveBuild.ts')
    return bootApp(root, () => loadBuild({ root, out }))
}

// BESIDE THE APP RATHER THAN BESIDE THE SHELL: an app's build belongs to the app.
export function buildDirectory(root: string): string {
    return `${dirname(root)}/.abide`
}

// THE DIRECTORY `ui/` SITS UNDER — 38.26 and 38.27. `undefined` is a refusal and not a guess.
export function appRoot(given: string | undefined): string | undefined {
    if (given !== undefined) return resolve(given)
    const here = process.cwd()
    if (existsSync(`${here}/ui`)) return here
    const under = resolve('src')
    return existsSync(`${under}/ui`) ? under : undefined
}

export async function bootApp(
    root: string,
    load: () => Promise<LoadedSources>,
): Promise<App> {
    // 37.1 — OPTIONAL, and imported for what it CALLS: every hook it runs is filed by the time the
    // import settles.
    const hooksModule = `${root}/server/app.ts`
    const own = existsSync(hooksModule)
        ? ((
              (await import(Bun.pathToFileURL(hooksModule).href)) as {
                  default?: OwnRoute
              }
          ).default ?? undefined)
        : undefined

    // 37.4 — THE BOOT, INSIDE `onStart`. 37.6 — a throw out of a hook or out of the boot rejects
    // `createApp`, and nothing is served.
    //
    // 42.2 — THE CONFIGURATION IS READ AS PART OF THE BOOT, so a configuration that does not resolve
    // is a boot that fails rather than a first request that does.
    CONFIG_ROOT.current = root
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
        fetch: (request) => fetch(request),
    }

    // 16.15, 37.3 — THE APP LANE'S ONION, composed once over the whole request path.
    const answer = compose(HOOKS.rungs, ({ request }) =>
        answerRequest(booted, request),
    )

    const open = new Set<Bun.ServerWebSocket<Connection>>()
    const sockets = socketHandlers(booted.sockets)
    let inFlight = 0
    let drained: (() => void) | undefined
    let stopping = false
    let bound: Bun.Server<unknown> | undefined

    const run = async <Result>(
        fn: () => Result | Promise<Result>,
        options?: { request?: Request },
    ): Promise<Result> => inScope(options?.request, fn)

    const fetch = async (given: Request): Promise<Response> => {
        if (stopping)
            return new Response('the app is stopping', { status: 503 })
        const request = belowMount(given)
        inFlight += 1
        const started = performance.now()
        try {
            // 42.6 — `run`, with dispatch over it — and the headers every answer carries stamped
            // inside it, where the trace the request was answered under is still the current one.
            return await run(
                async () => {
                    let answered: Response
                    try {
                        answered = await answer({ request })
                    } catch (thrown) {
                        reportUnexpected(thrown)
                        answered = new Response('internal server error', {
                            status: 500,
                        })
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
                { request },
            )
        } finally {
            inFlight -= 1
            if (inFlight === 0) drained?.()
        }
    }

    // 16.44 — a `raw` call made on this server is answered by this app, in process.
    RPC_SERVER.raw = fetch

    return {
        fetch,
        run,
        // 42.9 — the socket, and what `server` hands back from then on.
        async listen(options) {
            const port = options?.port
            const server = Bun.serve<Connection>({
                ...(options?.unix !== undefined
                    ? { unix: options.unix }
                    : port !== undefined
                      ? { port }
                      : {}),
                // 18.2 — THE ONE MUX, upgraded before anything else is asked of the request.
                fetch: (request, server) => {
                    if (
                        booted.sockets.size > 0 &&
                        request.headers.get('upgrade') === 'websocket' &&
                        new URL(request.url).pathname.endsWith(
                            SOCKET_ADDRESS,
                        ) &&
                        server.upgrade(request, { data: connectionOf(request) })
                    )
                        return undefined
                    return fetch(request)
                },
                websocket: {
                    ...sockets,
                    open(ws) {
                        open.add(ws)
                    },
                    close(ws, code, reason) {
                        open.delete(ws)
                        sockets.close?.(ws, code, reason)
                    },
                },
            })
            bound = server as unknown as Bun.Server<unknown>
            LISTENING.server = bound
        },
        // 42.10 — stop accepting, drain, and only then the teardown `onStop` wraps (37.4).
        async stop() {
            stopping = true
            // 42.11 — every open socket is closed rather than left to the process's exit.
            for (const ws of open) ws.close(1001, 'the app is stopping')
            open.clear()
            await bound?.stop()
            if (inFlight > 0)
                await new Promise<void>((done) => {
                    drained = done
                })
            if (LISTENING.server === bound) LISTENING.server = undefined
            bound = undefined
            await compose(HOOKS.stops, async () => {})(undefined)
        },
    }
}

// 21.1, 21.2 — ON EVERY ANSWER, a refusal and a 404 included. A `Response` whose headers are
// immutable — one a handler got from `fetch` and returned — is copied rather than written to.
//
// 22.9 — AND WHAT WAS WRITTEN THROUGH `response`, laid over every answer here and nowhere else: a
// lane builds its answer at the written status and leaves the headers to this.
function stamp(answered: Response): Response {
    let stamped = answered
    try {
        stamped.headers.set('x-content-type-options', 'nosniff')
    } catch {
        stamped = new Response(answered.body, answered)
        stamped.headers.set('x-content-type-options', 'nosniff')
    }
    const status = applyWritten(stamped.headers)
    if (status !== 200 && status !== stamped.status)
        stamped = new Response(stamped.body, {
            status,
            statusText: stamped.statusText,
            headers: stamped.headers,
        })
    const traced = traceResponse()
    if (traced !== undefined) stamped.headers.set('traceresponse', traced)
    return stamped
}

// 16.11 — A REQUEST UNDER THE MOUNT IS ANSWERED AS THE ADDRESS BELOW IT; one that is not — a proxy
// that already took the prefix off — is answered as it came.
function belowMount(request: Request): Request {
    if (MOUNT.current() === '') return request
    const url = new URL(request.url)
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
