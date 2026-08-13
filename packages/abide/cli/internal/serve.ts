// The worker `abide dev` runs the app in.
//
// A WORKER rather than a child process, and rather than nothing at all. The constraint that rules out
// "nothing at all" is that a module graph is cached by resolved path and cannot be evicted:
// re-importing `app.ts` behind a cache-busting query reloads that one file while every module it
// imports stays the version already in memory, so the app becomes half of two versions with nothing
// saying so. Something has to be thrown away whole.
//
// A worker is the smallest thing that can be. Each one is its own isolate with its own module
// registry, so a fresh worker re-reads the whole graph — the leaf three imports down included — and
// terminating the old one is what makes that true rather than hopeful. It costs a few milliseconds,
// where a process costs a Bun startup on every save, and it keeps `abide dev` a single process: one
// pid to watch, one to profile, one to kill, and no way to leave a server behind that outlived
// whatever was supervising it.
//
// What that buys is paid for in one place: signals are NOT delivered to a worker. `boot` installs
// handlers here and they never fire, so the main thread owns the lifecycle and says `stop` over a
// message. Everything else about the app is exactly what `abide start` boots.
//
// Three things differ from `abide start`, and they are the three a developer is actually asking for:
//
//   the bundle    built HERE, into memory, unminified and uncompressed. Nothing is written to
//                 `.abide/client`, so `abide dev` cannot leave a half-built directory behind for the
//                 next `abide start` to serve
//   the port      HOPS. A developer wants the thing to come up; a deploy wants to fail loudly, which
//                 is why `abide start` refuses the same case
//   the shell     names a reload client this worker serves, which is a socket through the ordinary
//                 mux and not a second server on a second port
//
// The reload is a full page load rather than a module swap. A restart already threw away every piece
// of server state, so there is nothing on the client worth preserving against it — and "the browser
// shows what the files say" is a claim a full load can actually make.

import { config } from '$server/config.ts'
import { boot, shutdown } from '$server/lifecycle.ts'
import { register, websocket } from '$server/registry.ts'
import { socket } from '$server/rpc.ts'
import { mountBase, mounted, unmounted } from '$shared/internal/mount.ts'
import { RELOAD_PATH, SOCKET_PREFIX } from '$shared/internal/PATHS.ts'
import { messageOf } from '$shared/internal/probes.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { CLIENT_KEY, clientGraph, entryNames } from '../CLIENT_BUILD.ts'
import { heldClient, type LoadedClient } from './assets.ts'
import { clientLane } from './entry.ts'
import { clientBuild, type Lane } from './lane.ts'
import { type Answer, assemble, portFrom, report } from './layers.ts'

/**
 * The worker's own global surface, named rather than assumed.
 *
 * `self` is only typed where the DOM's worker lib is, and this package's `lib` is the runtime's. The
 * two members this needs are the whole protocol, so writing them down is cheaper than a lib that
 * would also hand every other file a `window`.
 */
const scope = globalThis as unknown as {
    postMessage: (message: unknown) => void
    onmessage: ((event: { data: unknown }) => void) | null
}

/** Main → here. `argv` starts the app; `stop` drains it. */
export interface Asked {
    argv?: string[]
    /** The port the LAST worker bound, or `null` on the first. See `dev.ts`. */
    bind?: number | null
    stop?: boolean
}

/** Here → main: it is up on `port`, or it refused with `refused` as the exit code. */
export interface Said {
    ready?: boolean
    port?: number
    refused?: number
    stopped?: boolean
}

/**
 * Where a browser waits to be told the app came back.
 *
 * Under the reserved prefix and through the ordinary socket mux, so a dev server claims no address
 * an operator does not already proxy with one pattern — and so the reload path is the same transport
 * every other socket in the app uses rather than a private one that only works in development.
 *
 * Namespaced under `abide/` because the id space is the app's: a project with its own
 * `server/sockets/reload.ts` registers `reload`, and two declarations at one address is one of them
 * silently winning.
 */
const RELOAD_ID = 'abide/reload'

/**
 * Nothing is ever published on it, and that is the design.
 *
 * The signal is the CONNECTION, not a message: this worker being torn down is what closes every
 * subscriber's socket, and the next one accepting a connection is what says the app is back. A
 * message would need a live server to send it, which is exactly what a restart does not have — a
 * "reload now" frame can only be written by a process that is about to stop being the one serving
 * the page.
 */
const reload = socket<never>()
register('socket', [[RELOAD_ID, 'reload']], { reload })

/**
 * This worker's identity, so a RECONNECT can be told from a RESTART.
 *
 * Reopening the socket was taken as proof the app had come back, and it is not: a laptop that slept,
 * a proxy that timed the connection out, a browser reclaiming an idle socket all close it against a
 * server that never went anywhere. The page then reloaded for no reason — and because a reload
 * queued behind a busy main thread lands the moment it frees, what that looks like is a long-running
 * page throwing everything away the instant it finishes. Every measurement on `/bench`, gone, with
 * nothing in the console and nothing having changed on disk.
 *
 * A boot id makes the question answerable: the client bakes in the one it loaded with, and asks on
 * every reconnect whether the server on the other end is still that process.
 */
const BOOT_ID = Bun.randomUUIDv7()

/**
 * The reload client, hand-written and served from this worker's memory at `RELOAD_PATH`.
 *
 * Not from the bundle, because a client build that is BROKEN is exactly when a developer needs the
 * page to still reconnect and reload itself once the build is fixed. Reconnecting is the whole of it
 * — the first open is this page's own, and any open after that is a server that was not there when
 * the page loaded.
 *
 * A file rather than an inline `<script>` for the reason `RELOAD_PATH` states: an app running `csp()`
 * refuses inline script it did not stamp, and a head cut once at boot has no per-request nonce to be
 * stamped with. That failure is the quiet kind — the page renders, and only the reloading stops.
 *
 * The backoff exists so a page left open after Ctrl-C is not a socket attempt every 100ms forever.
 */
// Built per BOOT rather than at import, because the mount is `APP_URL`'s and config has not been
// resolved when this module is loaded. One string per dev process, which is what it was before.
const reloadSource = (): string =>
    '(()=>{' +
    `const at=(location.protocol==='https:'?'wss://':'ws://')+location.host+${JSON.stringify(mounted(SOCKET_PREFIX + RELOAD_ID))};` +
    `const who=${JSON.stringify(mounted(RELOAD_PATH) + BOOT_QUERY)},id=${JSON.stringify(BOOT_ID)};` +
    'let seen=false,wait=100;' +
    // The reconnect ASKS rather than assumes. A fetch that fails leaves the page alone: the server
    // is not answering, so it is not the one to reload against, and the next close will try again.
    'const back=()=>fetch(who,{cache:"no-store"}).then(r=>r.text()).then(t=>{if(t!==id)location.reload()},()=>{});' +
    'const open=()=>{const live=new WebSocket(at);' +
    'live.onopen=()=>{if(seen)back();seen=true;wait=100};' +
    'live.onclose=()=>setTimeout(open,wait=Math.min(wait*2,1000))};' +
    'open()})()'

/** What the client appends to `RELOAD_PATH` to ask who is answering. See `BOOT_ID`. */
const BOOT_QUERY = '?boot'

/**
 * What the head carries instead — appended to the end of the shell's head.
 *
 * `defer` so the document's parse does not wait on a fetch: a page that streams is one this would
 * otherwise stall at the head, and the socket is worth nothing until there is a page to reload.
 */
const reloadTag = (): string => `<script defer src="${mounted(RELOAD_PATH)}"></script>`

/** Dev's own file, in FRONT of the app — or `undefined` when the request is the app's. */
function reloadClient(request: Request, source: string): Response | undefined {
    // The raw url text first and the parsed pathname deciding, exactly as the bundle route does it:
    // an app's own request pays one substring test rather than a URL parse.
    if (!request.url.includes(RELOAD_PATH)) return undefined
    const url = new URL(request.url)
    if (unmounted(url.pathname) !== RELOAD_PATH) return undefined
    // Who is answering, for a client deciding whether its socket came back to the SAME process. The
    // same address rather than one of its own: it is already exempt from the app's pipeline, already
    // uncached, and already the one path a page loaded by `abide dev` is guaranteed to be able to
    // reach — a second route would be a second thing to keep in front of `csp()` and the mount.
    if (url.search === BOOT_QUERY) {
        return new Response(BOOT_ID, {
            headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        })
    }
    return new Response(source, {
        headers: {
            'content-type': 'text/javascript; charset=utf-8',
            // Every dev asset's answer: the address is stable, so the bytes behind it are not.
            'cache-control': 'no-store',
            // This route never reaches `headersFor` — it is answered in front of the pipeline — and
            // what it hands back is JavaScript on the app's own origin.
            'x-content-type-options': 'nosniff',
        },
    })
}

/** How far `--port` will walk before giving up. A range, so a busy machine fails rather than spins. */
const HOPS = 64

/** The socket this worker bound, so `stop` can reach it. Null until it is up. */
let bound: ReturnType<typeof Bun.serve> | null = null

scope.onmessage = (event): void => {
    const asked = event.data as Asked
    if (asked.stop === true) void halt()
    else if (asked.argv !== undefined) void run(asked.argv, asked.bind ?? null)
}
// Last, so main is never told this is listening before there is an `onmessage` to hear the reply.
scope.postMessage({ ready: true } satisfies Said)

async function run(argv: string[], pin: number | null): Promise<void> {
    const asked = portFrom(argv)
    if (typeof asked === 'string') {
        console.error(`abide dev: ${asked}`)
        console.error('       usage: abide dev [--port <n>]')
        return scope.postMessage({ refused: CLI_EXIT_CODES.usage } satisfies Said)
    }
    // The same rule `abide start` states: the flag is spelled as the VARIABLE, so `config().PORT` is
    // the one answer to what this process was asked to listen on rather than a second number beside
    // it.
    if (asked !== null) process.env.PORT = String(asked)
    // And the pin beats the flag, for the reason the flag beats an app's own default: it is the more
    // specific statement about where this SESSION lives. It is the port a previous worker actually
    // bound, so honouring it is what keeps a restart invisible to a page that is already open.
    if (pin !== null) process.env.PORT = String(pin)

    const root = process.cwd()
    // Unawaited. The bundle and the app's own module graph read nothing of each other, and `assemble`
    // does not look at the bundle until it cuts the shell — so on every save the build runs beside the
    // handler scan and the `app.ts` import rather than in front of them.
    const building = bundle(root)

    // Read BEFORE the app is assembled, and not only for the port: resolving the document is what
    // installs the mount from `APP_URL`, and the shell `assemble` cuts carries that in every asset
    // href it writes. A shell cut against the root and served under a sub-path is a page of 404s.
    const first = config().PORT

    const assembled = await assemble({ root, label: 'abide dev', client: building, head: reloadTag() })
    if (typeof assembled === 'number') return scope.postMessage({ refused: assembled } satisfies Said)

    // The reload client in front of the app, the way the bundle is: it is this command's file rather
    // than a route the app could know about, and a middleware onion has nothing to say about it.
    const source = reloadSource()
    const answering: Answer = (request, server) =>
        reloadClient(request, source) ?? assembled.answer(request, server)
    let running: Awaited<ReturnType<typeof boot<ReturnType<typeof Bun.serve>>>>
    try {
        running = await boot(() => {
            bound = listening(first, answering)
            return bound
        })
    } catch (failure) {
        console.error(`abide dev: ${messageOf(failure)}`)
        return scope.postMessage({ refused: CLI_EXIT_CODES.failed } satisfies Said)
    }
    // `boot` says so on `abide:lifecycle` — an `onStart` that returned without calling `start()` is
    // the app deciding this process should not serve, so it is an outcome rather than a failure.
    if (running === null) return scope.postMessage({ refused: CLI_EXIT_CODES.ok } satisfies Said)

    // A `Server`'s own `port` is optional because a unix socket has none, and this one always bound a
    // TCP port — the fallback is the number it was asked for, which is also the only case where the
    // two agree.
    const landed = running.port ?? first

    // The socket is the truth about this process now, so the document is corrected to match it.
    // `APP_URL` in particular: it is what `abide logs` in another terminal resolves the app by, and a
    // hop that left it naming the port somebody ASKED for would point every reader at whatever else
    // is on it. `invalidate` rather than a second answer beside `config()`, which is the whole reason
    // that verb exists.
    process.env.PORT = String(landed)
    // The ORIGIN is corrected and the PATH is kept: the socket is the truth about where this process
    // is listening, and it says nothing at all about where an operator mounted the app. Overwriting
    // the whole value would unmount a dev process one hop after it started, and silently — every href
    // in the shell was already cut against the base that was there when `assemble` ran.
    process.env.APP_URL = running.url.origin + mountBase()
    config.invalidate()

    const hopped = first !== 0 && landed !== first ? `hopped from ${first}` : undefined
    report(running.url.href, assembled, hopped)
    scope.postMessage({ port: landed } satisfies Said)
}

/**
 * Drain this worker so the next one can have the port.
 *
 * The socket is closed FORCIBLY and first, then the app drains around it. A socket never ends — that
 * is what a socket is — so the graceful close inside `shutdown()` waits for the connections the
 * server is holding, and one browser tab on the reload channel makes that wait unbounded. Closing
 * first means the app's `onStop` still runs, on every restart, rather than being the thing that hangs.
 */
async function halt(): Promise<void> {
    bound?.stop(true)
    bound = null
    try {
        await shutdown()
    } catch (failure) {
        console.error(`abide dev: the app did not drain cleanly — ${messageOf(failure)}`)
    }
    scope.postMessage({ stopped: true } satisfies Said)
}

/**
 * The socket, walking up from `first` until one binds.
 *
 * Port `0` is the kernel's own spelling of "whatever is free", so there is nothing to hop TO and a
 * failure there is a real one. Anything that is not `EADDRINUSE` is real too — a permission error
 * walking up the range would try 64 ports and report the last one, which describes nothing.
 */
function listening(first: number, answer: Answer): ReturnType<typeof Bun.serve> {
    let port = first
    for (;;) {
        try {
            return Bun.serve({
                port,
                // On, where `abide start` has it off. The reason production keeps it off — Bun answers
                // an uncaught throw with a page describing the stack — is the reason development wants
                // it: there is no operator to leak to, and the stack is the point.
                development: true,
                // Spelled for the reason `abide start` spells it: Bun reads SO_REUSEPORT off
                // `development`, and a bind that cannot fail is a hop that never happens. Dev gets
                // the value it wants by accident today — said out loud, the hop stops depending on
                // what the other flag is for.
                reusePort: false,
                fetch: answer,
                websocket,
            })
        } catch (failure) {
            const spent = first === 0 || port - first >= HOPS || port >= 65535
            if (spent || (failure as { code?: string }).code !== 'EADDRINUSE') throw failure
            port++
        }
    }
}

/**
 * The three `abide build` decisions this command reverses.
 *
 * Minifying costs wall time on every save and buys nothing over a loopback; the names stay SOURCE
 * names so a breakpoint and a stack frame survive a rebuild — which is what `no-store` on every dev
 * asset pays for. A chunk keeps its hash because nothing points a human at one by name.
 */
const HELD: Lane = {
    minify: false,
    naming: { entry: '[name].[ext]', chunk: '[name]-[hash].[ext]', asset: '[name].[ext]' },
    sourcemap: 'linked',
}

/**
 * The client lane, bundled into memory — or `null` for an app that has no client lane at all.
 *
 * A build that FAILS is not a process that refuses, and neither is a lane this cannot even read.
 * The pages still render, the endpoints still answer, and the reload client is served by this worker
 * rather than out of the bundle, so the page that comes up can still reconnect and reload itself the
 * moment the build is fixed — which is the whole loop a developer is in when a build is broken.
 * `abide start` makes the opposite call about the same state, and both are right: one is being asked
 * to serve, and this one is being asked to help.
 *
 * So this NEVER rejects, which is also what lets `run` leave it in flight: a refusal from `assemble`
 * returns without ever looking at it, and a promise nobody awaited is an unhandled rejection that
 * would take the worker down instead of the message that explains it.
 */
async function bundle(root: string): Promise<LoadedClient | null> {
    try {
        // Regenerated per rebuild rather than once at startup, because a page ADDED is a row the
        // table has to grow — and `.abide/` is what the watcher already ignores, so writing here is
        // not a save that triggers the rebuild that writes it.
        const lane = await clientLane(root)
        if (lane === null) return null

        const built = await clientBuild([lane], HELD, root)
        if (built.success) {
            return await heldClient(
                built.outputs,
                entryNames(root, [lane], built.outputs, [CLIENT_KEY]),
                clientGraph(built.metafile, root),
            )
        }
        for (const message of built.logs) console.error(String(message))
    } catch (failure) {
        console.error(`abide dev: ${messageOf(failure)}`)
    }
    console.error('abide dev: the client did not build — serving without a bundle')
    return null
}
