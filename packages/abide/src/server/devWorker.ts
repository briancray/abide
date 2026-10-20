// 38.14 — THE APP, IN A CHILD PROCESS. Everything an app's own code touches is in here: the modules
// it compiled to, the client bundle, and the render. The listener is the parent (`serveDev`), so
// replacing this process is how a reload happens and nothing an app left behind — a module in the
// registry, a timer, a `share`, a file bun once failed to find — survives one.
//
// THE COMPILER IS NOT THE APP, and it stays outside: `serveDev` compiles and sends the modules
// in, so the compiler is loaded once for every reload — `serveDev` says what that saves.
//
// NOTHING IS WRITTEN TO DISK (38.16). The compilation arrives as text and is served through the one
// plugin `abide start` serves a build's through (`abideModules`): at runtime for the server modules
// this worker imports, and in the bundle a browser fetches — each `.abide` at its own path, so a
// module's imports resolve from the source that wrote them in either.
//
// A REQUEST ARRIVES AS A MESSAGE, and its answer leaves as a head and then a chunk per pull (38.35,
// 38.36) — `responseRelay`'s worker half, `serveOver`.
//
// 18.1, 18.3 — AND SO DOES A SOCKET. The listener holds the browser's web socket, which has to
// outlive this worker; what crosses is each frame, tagged with the connection it came over, and
// what goes back is each frame this worker's mux sends. The mux is the one `abide start` runs.

import { DEV_ADDRESS } from '#shared/ADDRESSES.ts'
import { escapeText } from '#shared/escapeText.ts'
import {
    type Compilation,
    serveCompilation,
    servedTable,
} from './abideModules.ts'
import { type AppSources, appSources } from './answerRequest.ts'
import type { Mux, MuxConnection } from './answerSocket.ts'
import { publishedUnder } from './appTree.ts'
import {
    bundleServer,
    type ClientBundle,
    clientBundle,
    type ServedFile,
} from './clientBundle.ts'
import { type BootedApp, bootApp, originUnder } from './createApp.ts'
import { keepServing } from './faultPolicy.ts'
import { type Manifest, NO_MANIFEST } from './manifestOf.ts'
import { admitsMux, muxSocketOptions } from './muxUpgrade.ts'
import { LISTENING } from './requestScope.ts'
import {
    describe,
    type FromRelay,
    serveOver,
    type ToRelay,
} from './responseRelay.ts'
import { withAbideSources } from './withAbideSources.ts'

// The reload client, which the worker serves and every document it answers loads.
const RELOAD_CLIENT_ADDRESS = `${DEV_ADDRESS}/client.js`

/**
 * A message from the listener to this worker.
 *
 * 38.14 — WHAT CROSSES BETWEEN THE LISTENER AND THIS WORKER, one union per direction. In: the app
 * compiled (and what stopped it compiling, where something did), a request, a pull or cancel of
 * its body, and each browser web socket's frames for the mux.
 */
export type ToWorker =
    | {
          kind: 'start'
          root: string
          compilation: Compilation
          /** Every public file, to its address, as the compile's walk found them. */
          published: Map<string, string>
          failure: string
      }
    | ToRelay
    | {
          kind: 'socket-open'
          connection: number
          url: string
          headers: [string, string][]
      }
    | { kind: 'socket-message'; connection: number; text: string }
    | { kind: 'socket-close'; connection: number }

/**
 * A message from this worker to the listener.
 *
 * Out: ready, a frame the mux sends a browser, and what answers a request (`FromRelay`).
 */
export type FromWorker =
    | { kind: 'ready'; muxOptions: ReturnType<typeof muxSocketOptions> }
    | { kind: 'socket-send'; connection: number; text: string }
    | FromRelay

/**
 * Sends a message to the listener.
 *
 * 38.14 — over bun's IPC: this is its child process (`serveDev` says why a process).
 */
function toListener(message: FromWorker): void {
    process.send?.(message)
}

// THE COMPILE, AS SOMETHING TO WAIT ON. A request that arrives while the worker is still
// compiling has to wait for the app rather than be told there is none: the listener forwards
// every request to the CURRENT worker the moment it replaces one, so without this the first
// request after a save is answered with the failure document for a failure that never happened.
let opening: Promise<void> | undefined

let app: BootedApp | undefined
// 18.1 — the mux over this worker's handlers, and each connection the listener holds.
let mux: Mux | undefined
// What the mux carries, which `admitsMux` reads: an app with no handler has no mux to open.
let carried: AppSources | undefined
const connections = new Map<number, MuxConnection>()
// What stopped the app compiling, kept rather than thrown: 38.4 keeps the server up and 38.17
// keeps it up through a bundle that failed, so the failure is something to SERVE.
let failure = ''

// Each request the listener sends, answered by the app this worker booted.
const relay = serveOver(
    { postMessage: toListener },
    {
        async fetch(request) {
            await opening
            return app === undefined
                ? failedDocument(failure)
                : await app.fetch(request)
        },
        admits: (request, response) =>
            carried !== undefined && admitsMux(request, response, carried),
        failed: failedDocument,
        failureMarkup,
    },
)

// 16.23 — THE LISTENER HOLDS THE CONNECTION, so a request's idle timeout is set there, on
// the request bun handed it.
LISTENING.timeout = relay.timeout

// EVERY REQUEST IN FLIGHT HANGS UP WITH THIS WORKER, as each would with `abide start`'s process: a
// handler that spawned under `request().signal` takes its child down, where an exit alone left it
// running under launchd. The listener ends this worker on every reload, and its own end — killed
// rather than ended — is a disconnect.
function hangUpAndExit(): void {
    relay.hangUpAll()
    process.exit(0)
}
process.on('disconnect', hangUpAndExit)
process.on('SIGTERM', hangUpAndExit)

keepServing()

process.on('message', (message: ToWorker) => void receive(message))

async function receive(message: ToWorker): Promise<void> {
    if (message.kind === 'start') {
        opening = open(message)
        await opening
        toListener({ kind: 'ready', muxOptions: muxSocketOptions() })
        return
    }
    if (
        message.kind === 'request' ||
        message.kind === 'pull' ||
        message.kind === 'cancel'
    )
        return relay.take(message)
    await opening
    if (message.kind === 'socket-open') {
        const numbered = message.connection
        const connection = mux?.connect(
            new Request(message.url, { headers: message.headers }),
            {
                send(text: string) {
                    toListener({
                        kind: 'socket-send',
                        connection: numbered,
                        text,
                    })
                },
                // NOTHING TO CLOSE: the listener holds the browser's socket, and it outlives this
                // worker (38.14). Nothing here stops the mux, either.
                close() {},
            },
        )
        if (connection !== undefined) connections.set(numbered, connection)
        return
    }
    const connection = connections.get(message.connection)
    if (connection === undefined) return
    if (message.kind === 'socket-message')
        return connection.message(message.text)
    connections.delete(message.connection)
    connection.close()
}

/**
 * Boots the app over the modules the listener sent, or records why it could not.
 *
 * A throw anywhere in here leaves `app` undefined and the message in `failure`, which is what 38.4
 * asks for: the command keeps answering, and what it answers says what is wrong.
 */
async function open(
    start: Extract<ToWorker, { kind: 'start' }>,
): Promise<void> {
    app = undefined
    mux = undefined
    carried = undefined
    failure = start.failure
    if (failure !== '') return
    const root = start.root
    const compilation = start.compilation
    try {
        // ONE PLUGIN, TWO CALLERS: the runtime resolves this worker's `import()` through it and
        // the bundler resolves the browser's graph through it, so the two lanes cannot disagree
        // about what a specifier means. Registering it is process-wide — which is a worker rather
        // than the command, so a reload is a new registry rather than a cache to bust.
        serveCompilation(root, compilation)

        // ASKED FOR TOGETHER. The bundle, the public directory and the server's own
        // tables depend on none of each other — the plugin is registered above, before any of
        // them asks it anything — and on a reload every one of them is latency the author waits on,
        // so the bundle is handed over still building (`SourceParts.client`).
        //
        // ONE LISTING of the public directories — the compile's — for the bundle's externals and for
        // what is served. 38.19 — OUT OF THE SOURCE TREE. `abide build` copies these into its output
        // and dev has no output, so the address answers where the author's file actually is.
        const published = publishedUnder(root, start.published)
        const bundling = bundleInMemory(root, compilation, start.published)
        const table = await servedTable(root)
        const handlers = table.handlers

        // THE SAME `App` `abide start` boots, so an app's hooks and middleware run in dev too — and its
        // sources are read INSIDE the boot, as `abide start` reads them: a document's head carries
        // what the resolved configuration says (28.4's app name), which is not resolved before it.
        app = await bootApp(originUnder(root), async () => {
            // 38.17 — THE RELOAD CLIENT IS THIS WORKER'S, not the bundle's, and it goes in whether or
            // not there is an entry beside it: a bundle that failed is exactly when a reader needs the
            // next save to reach them. `clientTags` writes nothing for a manifest with no entry.
            const sources = await appSources({
                table,
                handlers,
                published,
                client: bundling.then((bundle) => ({
                    manifest: bundle.manifest,
                    head: `<script type="module" src="${RELOAD_CLIENT_ADDRESS}"></script>`,
                    // 45.9 — a worker `abide start` registered on this origin is removed rather than
                    // left answering a dev server from what it saved.
                    offline: false,
                    framework: (pathname, request) =>
                        pathname === RELOAD_CLIENT_ADDRESS
                            ? new Response(RELOAD_CLIENT, {
                                  headers: {
                                      'content-type':
                                          'text/javascript; charset=utf-8',
                                      'cache-control': 'no-store',
                                  },
                              })
                            : bundle.framework(pathname, request),
                })),
                explained: (thrown) => failedDocument(describe(thrown)),
            })
            carried = sources
            return sources
        })
        // 18.1 — the mux `App.listen` would open, over the app's own record: a frame's `rpc.raw` and
        // MCP surface are this app's.
        mux = app.openMux()
    } catch (thrown) {
        failure = thrown instanceof Error ? thrown.message : String(thrown)
    }
}

/**
 * The client bundle (`clientBundle`), built into memory, and what answers it.
 *
 * A FAILURE IS AN EMPTY BUNDLE AND NOT A THROW (38.17). The pages still render, the document still
 * loads the reload client, and the next save is what fixes it — the error goes to THE TERMINAL
 * RATHER THAN THE DOCUMENT, where the author started the command.
 */
async function bundleInMemory(
    root: string,
    compilation: Compilation,
    published: Map<string, string>,
): Promise<{ manifest: Manifest; framework: AppSources['framework'] }> {
    let bundle: ClientBundle
    try {
        bundle = await clientBundle(root, compilation, published, 'dev')
    } catch (thrown) {
        const logs = thrown instanceof AggregateError ? thrown.errors : []
        console.error(
            `${(thrown as Error).message}\n${logs.map((log) => String(log)).join('\n')}`,
        )
        bundle = { files: new Map(), manifest: NO_MANIFEST }
    }
    const files = new Map<string, ServedFile>()
    for (const [name, { bytes, type, kind }] of bundle.files) {
        let body: () => BodyInit = () => bytes
        // 38.97 — PLACED ON THE FIRST ASK: only a debugger reads a map, and placing every chunk's up
        // front was ~45 ms of each reload on the docs app, whether or not one was open.
        if (kind === 'sourcemap') {
            let placed: Promise<string> | undefined
            body = () =>
                new ReadableStream({
                    async start(controller) {
                        placed ??= withAbideSources(
                            new TextDecoder().decode(bytes),
                            compilation,
                            root,
                        )
                        controller.enqueue(
                            new TextEncoder().encode(await placed),
                        )
                        controller.close()
                    },
                })
        }
        files.set(name, { type, body, encoded: {} })
    }
    // NO CACHING AT ALL, which is where dev parts company with 21.5: the names are stable across
    // rebuilds, so a browser told to keep `entry.js` for a year keeps the app it had at boot.
    return {
        manifest: bundle.manifest,
        framework: bundleServer(files, 'no-store'),
    }
}

/**
 * What a reader gets while the project does not compile: the message, and the reload client.
 *
 * The reload client brings them the fix. A document rather than a bare 500 body — the browser is
 * where the author is looking, and an error only the terminal carries is one they read on the next
 * save.
 */
function failedDocument(why: string): Response {
    return new Response(
        `<!doctype html><html><head><meta charset="utf-8"><title>abide dev</title>
<script type="module" src="${RELOAD_CLIENT_ADDRESS}"></script></head>
<body>${failureMarkup(why)}</body></html>`,
        {
            status: 500,
            // 21.1, 21.3 — this answers where no app stands to stamp it.
            headers: {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'private, no-store',
                'x-content-type-options': 'nosniff',
            },
        },
    )
}

function failureMarkup(why: string): string {
    return `<main><h1>abide dev</h1><pre>${escapeText(why)}</pre></main>`
}

// 38.15's other end. The listener force-closes every live socket when it replaces this worker, so
// a CLOSE is the rebuild and the reconnect that follows is the new app — there is no message to
// send and nothing to version. A reader who never opened the socket is told nothing, which is the
// same as before the save.
const RELOAD_CLIENT = `// Written by \`abide dev\`.
const address = location.origin.replace(/^http/, 'ws') + '${DEV_ADDRESS}'
let rebuilt = false

function connect() {
    const socket = new WebSocket(address)
    socket.onopen = () => { if (rebuilt) location.reload() }
    // THE RETRY IS WHAT WAITS FOR THE NEW WORKER. The listener answers this address 503 until the
    // replacement has compiled, so a reload fired on the close alone would race the app it is
    // meant to show.
    socket.onclose = () => { rebuilt = true; setTimeout(connect, 120) }
}

connect()
`
