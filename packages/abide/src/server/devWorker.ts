// 38.15 — THE APP, IN A CHILD PROCESS. Everything an app's own code touches is in here: the modules
// it compiled to, the client bundle, and the render. The listener is the parent (`serveDev`), so
// replacing this process is how a reload happens and nothing an app left behind — a module in the
// registry, a timer, a `share`, a file bun once failed to find — survives one.
//
// THE COMPILER IS NOT THE APP, and it stays outside: `serveDev` compiles and sends the modules
// in, so the compiler is loaded once for every reload — `serveDev` says what that saves.
//
// NOTHING IS WRITTEN TO DISK (38.17). The modules arrive as text and are reached through a
// plugin: `Bun.plugin` for the server modules this worker imports, and a build plugin for the
// bundle a browser fetches. The paths they are keyed under mirror the output tree `abide build`
// would have written, so a module's imports resolve the same in either.
//
// A REQUEST ARRIVES AS A MESSAGE, and its answer leaves as a head and then a chunk per pull (38.36,
// 38.37): the listener asks for the next chunk when its connection has taken the last, so a stream
// is read no faster than the browser reads it. A request BODY is still collected, which is what
// lets the listener re-ask a request of the replacement (38.25).
//
// 18.2, 18.17 — AND SO DOES A SOCKET. The listener holds the browser's web socket, which has to
// outlive this worker; what crosses is each frame, tagged with the connection it came over, and
// what goes back is each frame this worker's mux sends. The mux is the one `abide start` runs.

import { CLIENT_ADDRESS, DEV_ADDRESS } from '#shared/ADDRESSES.ts'
import { escapeText } from '#shared/escapeText.ts'
import {
    appSources,
    type LoadedSources,
    type ServerTable,
} from './answerRequest.ts'
import type { Mux, MuxConnection } from './answerSocket.ts'
import { appPlugins } from './appPlugins.ts'
import { CLIENT_ENTRY, PUBLIC_DIRECTORY } from './CLIENT_BUILD.ts'
import {
    clientBuildOptions,
    stylesheetUnderMount,
} from './clientBuildOptions.ts'
import { type BootedApp, bootApp, originUnder } from './createApp.ts'
import { keepServing } from './faultPolicy.ts'
import { fenceServer } from './fenceServer.ts'
import { type Manifest, manifestOf, NO_MANIFEST } from './manifestOf.ts'
import { admitsMux } from './muxUpgrade.ts'
import { refuseAddressCollision } from './refuseAddressCollision.ts'
import { shellUnder } from './render.ts'
import { LISTENING } from './requestScope.ts'
import { handlersIn, pathsUnder, sourceModuleLoader } from './serveBuild.ts'
import { VIRTUAL_DIRECTORY } from './VIRTUAL_DIRECTORY.ts'

// The reload client, which the worker serves and every document it answers loads.
const RELOAD_CLIENT_ADDRESS = `${DEV_ADDRESS}/client.js`

// The bundle this worker answers `/__abide/client/…` out of, the type each name is served as, and
// the chunks each route module needs (38.29).
type Bundle = {
    // A stylesheet is held as its text, rewritten (`stylesheetUnderMount`); the rest as built.
    files: Map<string, { bytes: ArrayBuffer | string; type: string }>
    manifest: Manifest
}

/**
 * A message from the listener to this worker.
 *
 * 38.15 — WHAT CROSSES BETWEEN THE LISTENER AND THIS WORKER, one union per direction. In: the app
 * compiled (and what stopped it compiling, where something did), a request, a pull or cancel of
 * its body, and each browser web socket's frames for the mux.
 */
export type ToWorker =
    | {
          kind: 'start'
          root: string
          modules: Map<string, string>
          failure: string
      }
    | ({ kind: 'request' } & Ask)
    | { kind: 'pull'; id: number }
    | { kind: 'cancel'; id: number }
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
 * Out: ready, a frame the mux sends a browser, a request's idle timeout raised, and its head, each
 * chunk, and its end.
 */
export type FromWorker =
    | { kind: 'ready' }
    | { kind: 'socket-send'; connection: number; text: string }
    | { kind: 'timeout'; id: number; seconds: number }
    | {
          kind: 'head'
          id: number
          status: number
          statusText: string
          headers: [string, string][]
          empty: boolean
          /** 37.3 — whether the listener upgrades this request to the mux (`admitsMux`). */
          admitted: boolean
          /** A body whose length the answer declared, sent with its head rather than pulled. */
          whole: ArrayBuffer | undefined
      }
    | { kind: 'chunk'; id: number; bytes: ArrayBuffer }
    | { kind: 'end'; id: number }
    | { kind: 'fail'; id: number; message: string }

/** A request as it crosses to the worker: its id, and what the worker rebuilds it from. */
export type Ask = {
    id: number
    method: string
    url: string
    headers: [string, string][]
    body: ArrayBuffer | null
}

/**
 * Sends a message to the listener.
 *
 * 38.15 — over bun's IPC: this is its child process (`serveDev` says why a process).
 */
function toListener(message: FromWorker): void {
    process.send?.(message)
}
// The listener gone — its process killed rather than ended — takes this one with it.
process.on('disconnect', () => process.exit(0))

// THE COMPILE, AS SOMETHING TO WAIT ON. A request that arrives while the worker is still
// compiling has to wait for the app rather than be told there is none: the listener forwards
// every request to the CURRENT worker the moment it replaces one, so without this the first
// request after a save is answered with the failure document for a failure that never happened.
let opening: Promise<void> | undefined

let app: BootedApp | undefined
// 18.2 — the mux over this worker's handlers and sockets, and each connection the listener holds.
let mux: Mux | undefined
// What the mux carries, which `admitsMux` reads: an app with neither table has no mux to open.
let carried: LoadedSources | undefined
const connections = new Map<number, MuxConnection>()
// What stopped the app compiling, kept rather than thrown: 38.4 keeps the server up and 38.18
// keeps it up through a bundle that failed, so the failure is something to SERVE.
let failure = ''

keepServing()

process.on('message', (message: ToWorker) => void receive(message))

async function receive(message: ToWorker): Promise<void> {
    if (message.kind === 'start') {
        opening = open(message)
        await opening
        toListener({ kind: 'ready' })
        return
    }
    if (message.kind === 'pull') return pull(message.id)
    if (message.kind === 'cancel') {
        const reading = bodies.get(message.id)
        bodies.delete(message.id)
        return reading?.reader.cancel()
    }
    await opening
    if (message.kind === 'request') return answerAsk(message)
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
                // worker (38.15). Nothing here stops the mux, either.
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

// Each answer whose head has gone out, by request id: what its chunks are read from, and whether a
// failure in the middle can still be shown as markup.
const bodies = new Map<
    number,
    { reader: ReadableStreamDefaultReader<Uint8Array>; html: boolean }
>()

// 16.23 — THE LISTENER HOLDS THE CONNECTION, so the idle timeout a call raises is raised there, on
// the request bun handed it: each request built here is known by the ask it was built from.
const ASKS = new WeakMap<Request, number>()
LISTENING.timeout = (received, seconds) => {
    const id = ASKS.get(received)
    if (id !== undefined) toListener({ kind: 'timeout', id, seconds })
}

// A status whose response has no body to send, which `Response` refuses to be built with one.
const BODILESS = new Set([101, 204, 205, 304])

/**
 * Answers one request the listener sent, sending back its head and holding its body for pulls.
 *
 * A THROW BEFORE THE HEAD IS AN ANSWER, not a dropped message. The listener is waiting on a head
 * for this id and nothing else will send one, so an escape left the reader's tab hanging until
 * they gave up.
 */
async function answerAsk(ask: Ask): Promise<void> {
    const request = new Request(ask.url, {
        method: ask.method,
        headers: ask.headers,
        body: ask.body,
    })
    ASKS.set(request, ask.id)
    let response: Response
    try {
        response =
            app === undefined
                ? failedDocument(failure)
                : await app.fetch(request)
    } catch (thrown) {
        response = failedDocument(describe(thrown))
    }
    const body = BODILESS.has(response.status) ? null : response.body
    // A DECLARED LENGTH IS A BODY ALREADY WHOLE, and it crosses with its head: re-streamed through the
    // listener, bun meets a first read that has to wait on this worker and answers it chunked,
    // dropping the length the app declared.
    const whole =
        body !== null && response.headers.has('content-length')
            ? await response.arrayBuffer()
            : undefined
    toListener({
        kind: 'head',
        id: ask.id,
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        empty: body === null,
        admitted:
            carried !== undefined && admitsMux(request, response, carried),
        whole,
    })
    if (body === null || whole !== undefined) return
    bodies.set(ask.id, {
        reader: body.getReader(),
        html: (response.headers.get('content-type') ?? '').startsWith(
            'text/html',
        ),
    })
}

/**
 * Sends the listener the next chunk of an answer's body, or its end.
 *
 * ONE CHUNK PER ASK. A throw in the middle ends the stream in an error, as `abide start` does —
 * and where the answer is html a handler streams, what broke goes out as markup first, a reader
 * shown a blank tab otherwise being told nothing. A page is never here: it is built whole (41.1).
 */
async function pull(id: number): Promise<void> {
    const reading = bodies.get(id)
    if (reading === undefined) return
    try {
        const { done, value } = await reading.reader.read()
        if (done) {
            bodies.delete(id)
            toListener({ kind: 'end', id })
            return
        }
        // THE VIEW'S OWN BYTES. A chunk may be a view on a buffer its producer still owns — a
        // compressor's `Buffer` is a slice of a shared pool, and `Buffer#slice` copies nothing — so
        // sending `value.buffer` sent the whole pool.
        const bytes = new Uint8Array(value).buffer as ArrayBuffer
        toListener({ kind: 'chunk', id, bytes })
    } catch (thrown) {
        bodies.delete(id)
        const why = describe(thrown)
        if (reading.html) {
            const shown = new TextEncoder().encode(failureMarkup(why))
                .buffer as ArrayBuffer
            toListener({ kind: 'chunk', id, bytes: shown })
        }
        toListener({ kind: 'fail', id, message: why })
    }
}

function describe(thrown: unknown): string {
    return thrown instanceof Error
        ? (thrown.stack ?? thrown.message)
        : String(thrown)
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
    try {
        const base = `${root}/${VIRTUAL_DIRECTORY}`
        const modules = new Map<string, string>()
        for (const [name, text] of start.modules)
            modules.set(`${base}/${name}`, text)
        // A page among what compiled — an app of handlers alone has the tables and no client to
        // bundle.
        const paged = modules.has(`${base}/${CLIENT_ENTRY}.ts`)

        // ONE PLUGIN, TWO CALLERS: the runtime resolves this worker's `import()` through it and
        // the bundler resolves the browser's graph through it, so the two lanes cannot disagree
        // about what a specifier means. Registering it is process-wide — which is a worker rather
        // than the command, so a reload is a new registry rather than a cache to bust.
        const plugin = virtualModules(modules)
        Bun.plugin(plugin)

        // ASKED FOR TOGETHER. The bundle, the shell, the public directory and the server's own
        // tables depend on none of each other — the plugin is registered above, before any of
        // them asks it anything — and on a reload every one of them is latency the author waits on,
        // so the bundle is handed over still building (`SourceParts.client`).
        //
        // ONE LISTING of the public directory, for the bundle's externals and for what is served.
        // 38.20 — OUT OF THE SOURCE TREE. `abide build` copies these into its output and dev has no
        // output, so the address answers where the author's file actually is.
        const published = pathsUnder(`${root}/ui/${PUBLIC_DIRECTORY}`)
        const publicAddresses = Array.from(
            published.keys(),
            (name) => `/${name}`,
        )
        // 38.44 — the app's own plugins, imported beside the reads below rather than ahead of them.
        const bundling = appPlugins(root).then((own) =>
            bundleInMemory(
                root,
                base,
                // 16.29, 16.30 — the browser's view of `server/`, as `abide build` gives it.
                [plugin, fenceServer(root, start.modules), ...own],
                paged,
                publicAddresses,
            ),
        )
        const [shell, table, handlers] = await Promise.all([
            shellUnder(root),
            import(
                Bun.pathToFileURL(`${base}/server.ts`).href
            ) as Promise<ServerTable>,
            handlersIn(base),
        ])
        // 38.18 — THE RELOAD CLIENT IS THIS WORKER'S, not the bundle's, and it goes in whether or
        // not there is an entry beside it: a bundle that failed is exactly when a reader needs the
        // next save to reach them. `clientTags` writes nothing for a manifest with no entry.
        const sources = await appSources({
            table,
            shell,
            handlers,
            handlerModule: sourceModuleLoader(root, base),
            published,
            client: bundling.then((bundle) => ({
                manifest: bundle.manifest,
                head: `<script type="module" src="${RELOAD_CLIENT_ADDRESS}"></script>`,
                framework: (pathname) => served(bundle, pathname),
            })),
            explained: (thrown) => failedDocument(describe(thrown)),
        })

        // 36.13, IN THIS LANE TOO. A throw here lands in `failure`, which is what 38.4 asks
        // for: the command keeps answering and what it answers names both halves. Without it
        // `answerRequest` below would silently prefer the file — its public-before-routes
        // order rests on this collision being impossible.
        refuseAddressCollision(table.routes, publicAddresses, 'abide dev')

        carried = sources
        // THE SAME `App` `abide start` boots, so an app's hooks and middleware run in dev too.
        app = await bootApp(originUnder(root), async () => sources)
        // 18.2 — the mux `App.listen` would open, over the app's own record: a frame's `rpc.raw` and
        // MCP surface are this app's.
        mux = app.openMux()
    } catch (thrown) {
        failure = thrown instanceof Error ? thrown.message : String(thrown)
    }
}

function served(bundle: Bundle, pathname: string): Response | undefined {
    if (pathname === RELOAD_CLIENT_ADDRESS)
        return new Response(RELOAD_CLIENT, {
            headers: {
                'content-type': 'text/javascript; charset=utf-8',
                'cache-control': 'no-store',
            },
        })
    if (!pathname.startsWith(`${CLIENT_ADDRESS}/`)) return undefined
    const found = bundle.files.get(pathname.slice(CLIENT_ADDRESS.length + 1))
    if (found === undefined) return undefined
    // NO CACHING AT ALL, which is where dev parts company with 21.5: the names are stable across
    // rebuilds, so a browser told to keep `entry.js` for a year keeps the app it had at boot.
    return new Response(found.bytes, {
        headers: { 'content-type': found.type, 'cache-control': 'no-store' },
    })
}

/**
 * The client bundle, built into memory.
 *
 * 38.17 — Unminified, and the entry named by its source rather than content-hashed, so what a
 * browser loads and what a stack trace names are the module the author wrote. 38.5's hashes and
 * manifest are the BUILD's, and the difference is deliberate: a dev chunk that changed has to be
 * fetched again, and a name that changes with it is a cache the reload cannot clear.
 *
 * A FAILURE IS AN EMPTY BUNDLE AND NOT A THROW (38.18). The pages still render, the document
 * still loads the reload client, and the next save is what fixes it.
 */
async function bundleInMemory(
    root: string,
    base: string,
    plugins: Bun.BunPlugin[],
    paged: boolean,
    publicAddresses: string[],
): Promise<Bundle> {
    const bundle: Bundle = { files: new Map(), manifest: NO_MANIFEST }
    if (!paged) return bundle
    const built = await Bun.build({
        // 36.15's addresses off the source tree this lane answers them out of (38.20).
        ...clientBuildOptions(base, plugins, publicAddresses),
        // The app's own root, because `Bun.build` opens this directory and a virtual one is not
        // there to open. What it decides is where the output names are rooted, and the naming
        // below makes them flat anyway.
        root,
        naming: {
            entry: '[name].[ext]',
            chunk: '[name]-[hash].[ext]',
            asset: '[name]-[hash].[ext]',
        },
        throw: false,
    })
    // THE TERMINAL RATHER THAN THE DOCUMENT. 38.18 keeps the server up, and a page that still
    // paints is what it keeps up — so the pages stay served, unhydrated, and the author reads the
    // build error where they started the command.
    if (!built.success) {
        console.error(
            `abide dev: the client bundle failed\n${built.logs.map((log) => String(log)).join('\n')}`,
        )
        return bundle
    }
    // The chunks are independent, so they are read at once rather than one after another.
    const read = await Promise.all(
        built.outputs.map((output) => output.arrayBuffer()),
    )
    for (let index = 0; index < built.outputs.length; index += 1) {
        const output = built.outputs[index] as Bun.BuildArtifact
        const name = output.path.slice(output.path.lastIndexOf('/') + 1)
        const bytes = read[index] as ArrayBuffer
        bundle.files.set(name, {
            bytes: name.endsWith('.css')
                ? stylesheetUnderMount(new TextDecoder().decode(bytes))
                : bytes,
            type: output.type,
        })
    }
    // `base` AS GIVEN, with no real path taken: every route module is one the plugin served, and
    // the metafile names those under the plugin's namespace exactly as the plugin spelled them.
    bundle.manifest = manifestOf(built.metafile as Bun.BuildMetafile, base)
    return bundle
}

/**
 * The plugin serving the compiled modules out of `modules`, for the runtime and the bundler alike.
 *
 * A module in the map wins; everything else is resolved from where that module PRETENDS to be,
 * which is inside the app's package — so `abide`, `#ui/…` and a stylesheet all answer exactly as
 * they do for a build on disk.
 */
function virtualModules(modules: Map<string, string>): Bun.BunPlugin {
    return {
        name: 'abide-dev',
        setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
                if (modules.has(args.path))
                    return { path: args.path, namespace: 'abide-dev' }
                // The importer carries its namespace in front of the path when it is one of
                // ours — and the runtime puts a `/` in front of that again, where the bundler
                // does not. Both spellings are stripped here because a `file://` URL refuses to
                // take either as a base, and the one that was missed cost the whole route table:
                // every dynamic import in it read as a module nobody could find.
                const importer = args.importer.replace(/^\/?abide-dev:/, '')
                if (!modules.has(importer)) return undefined
                const from = importer.slice(0, importer.lastIndexOf('/'))
                if (args.path.startsWith('.')) {
                    const beside = Bun.fileURLToPath(
                        new URL(args.path, Bun.pathToFileURL(`${from}/`)),
                    )
                    if (modules.has(beside))
                        return { path: beside, namespace: 'abide-dev' }
                }
                // OUT OF THE MAP AND INTO THE PACKAGE. Resolved from the virtual directory rather
                // than left to the default, which has an `abide-dev:` prefix to walk up from and
                // finds nothing.
                try {
                    return {
                        path: Bun.resolveSync(args.path, from),
                        namespace: 'file',
                    }
                } catch {
                    return undefined
                }
            })
            // ONLY THE RUNTIME'S LOADS ARE REWRITTEN: the bundler asks `onResolve` above for a `#`
            // specifier itself, and a reload's loads are nearly all the bundler's — 181 of 183 on
            // the docs app, where the rewrite's parse was ~25 ms of each reload.
            const bundling = 'config' in build
            build.onLoad({ filter: /.*/, namespace: 'abide-dev' }, (args) => ({
                contents: bundling
                    ? (modules.get(args.path) ?? '')
                    : withSeamsResolved(
                          modules.get(args.path) ?? '',
                          args.path,
                      ),
                // 34.4 — a component's scoped styles are a stylesheet the bundle collects.
                loader: args.path.endsWith('.css') ? 'css' : 'ts',
            }))
        },
    }
}

// A `#` SPECIFIER IN A MODULE FROM THE MAP, resolved before the module is handed over. The runtime
// takes a `#` specifier to the package's `imports` itself rather than through this plugin, and from
// a module in the map it takes the target as an exact file — so the extensionless
// `#server/rpc/contacts` a component writes found nothing, where the bundler, which does ask the
// plugin, probed its way to the `.ts` through the same `Bun.resolveSync` — so the rewrite is the
// runtime's alone, and both lanes land on the same path.
const TRANSPILER = new Bun.Transpiler({ loader: 'ts' })

function withSeamsResolved(source: string, path: string): string {
    if (!path.endsWith('.ts')) return source
    const from = path.slice(0, path.lastIndexOf('/'))
    let resolved = source
    for (const { path: specifier } of TRANSPILER.scanImports(source)) {
        if (!specifier.startsWith('#')) continue
        let target: string
        try {
            target = Bun.resolveSync(specifier, from)
        } catch {
            continue
        }
        resolved = resolved
            .replaceAll(`'${specifier}'`, `'${target}'`)
            .replaceAll(`"${specifier}"`, `"${target}"`)
    }
    return resolved
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

// 38.16's other end. The listener force-closes every live socket when it replaces this worker, so
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
