// 38.15 — THE APP, IN A WORKER. Everything an app's own code touches is in here: the modules it
// compiled to, the client bundle, and the render. The listener is on the main thread
// (`serveDev`), so replacing this worker is how a reload happens and nothing an app left behind
// — a module in the registry, a timer, a `share` — survives one.
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
import { appSources, publicFilesUnder } from './answerRequest.ts'
import { connectionOf, type MuxSocket, socketHandlers } from './answerSocket.ts'
import { CLIENT_ENTRY, PUBLIC_DIRECTORY } from './CLIENT_BUILD.ts'
import { chunksByModule, type Manifest, NO_MANIFEST } from './chunksByModule.ts'
import { clientBuildOptions } from './clientBuildOptions.ts'
import { type App, bootApp } from './createApp.ts'
import { fenceServer } from './fenceServer.ts'
import { namesUnder } from './namesUnder.ts'
import { refuseAddressCollision } from './refuseAddressCollision.ts'
import { shellUnder } from './render.ts'
import { loadTables } from './serveBuild.ts'

// Where the compiled modules pretend to live. Under the app's own root so that `#ui/…` and a bare
// package name resolve from here exactly as they resolve from the build tree — both sit inside
// the app's package — and under a `__abide` directory for the reason the addresses are: no app
// writes one.
const VIRTUAL_DIRECTORY = '__abide'

// The reload client, which the worker serves and every document it answers loads.
const RELOAD_CLIENT_ADDRESS = `${DEV_ADDRESS}/client.js`

// The bundle this worker answers `/__abide/client/…` out of, the type each name is served as, and
// the chunks each route module needs (38.29).
type Bundle = {
    files: Map<string, { bytes: ArrayBuffer; type: string }>
    manifest: Manifest
}

// 38.15 — WHAT CROSSES BETWEEN THE LISTENER AND THIS WORKER, one union per direction. In: the app
// compiled (and what stopped it compiling, where something did), a request, a pull or cancel of its
// body, and each browser web socket's frames for the mux.
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
          conn: number
          url: string
          headers: [string, string][]
      }
    | { kind: 'socket-message'; conn: number; text: string }
    | { kind: 'socket-close'; conn: number }

// Out: ready, a frame the mux sends a browser, and a request's head, each chunk, and its end.
export type FromWorker =
    | { kind: 'ready' }
    | { kind: 'socket-send'; conn: number; text: string }
    | {
          kind: 'head'
          id: number
          status: number
          statusText: string
          headers: [string, string][]
          empty: boolean
      }
    | { kind: 'chunk'; id: number; bytes: ArrayBuffer }
    | { kind: 'end'; id: number }
    | { kind: 'fail'; id: number; message: string }

export type Ask = {
    id: number
    method: string
    url: string
    headers: [string, string][]
    body: ArrayBuffer | null
}

const worker = self as unknown as {
    onmessage: (event: MessageEvent<ToWorker>) => unknown
    postMessage(message: FromWorker, transfer?: Transferable[]): void
}

// THE COMPILE, AS SOMETHING TO WAIT ON. A request that arrives while the worker is still
// compiling has to wait for the app rather than be told there is none: the listener forwards
// every request to the CURRENT worker the moment it replaces one, so without this the first
// request after a save is answered with the failure document for a failure that never happened.
let opening: Promise<void> | undefined

let app: App | undefined
// 18.2 — the mux over this worker's handlers and sockets, and each connection the listener holds,
// as the stand-in the mux sends through.
let mux: ReturnType<typeof socketHandlers> | undefined
const connections = new Map<number, MuxSocket>()
// What stopped the app compiling, kept rather than thrown: 38.4 keeps the server up and 38.18
// keeps it up through a bundle that failed, so the failure is something to SERVE.
let failure = ''

worker.onmessage = async ({ data: message }) => {
    if (message.kind === 'start') {
        opening = open(message)
        await opening
        worker.postMessage({ kind: 'ready' })
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
        const { conn } = message
        const connection: MuxSocket = {
            data: connectionOf(
                new Request(message.url, { headers: message.headers }),
            ),
            send(text: string) {
                worker.postMessage({ kind: 'socket-send', conn, text })
            },
        }
        connections.set(conn, connection)
        mux?.open(connection)
        return
    }
    const connection = connections.get(message.conn)
    if (connection === undefined) return
    if (message.kind === 'socket-message')
        return mux?.message(connection, message.text)
    connections.delete(message.conn)
    mux?.close(connection)
}

// Each answer whose head has gone out, by request id: what its chunks are read from, and whether a
// failure in the middle can still be shown as markup.
const bodies = new Map<
    number,
    { reader: ReadableStreamDefaultReader<Uint8Array>; html: boolean }
>()

// A status whose response has no body to send, which `Response` refuses to be built with one.
const BODILESS = new Set([101, 204, 205, 304])

// A THROW BEFORE THE HEAD IS AN ANSWER, not a dropped message. The listener is waiting on a head for
// this id and nothing else will send one, so an escape left the reader's tab hanging until they gave
// up.
async function answerAsk(ask: Ask): Promise<void> {
    const request = new Request(ask.url, {
        method: ask.method,
        headers: ask.headers,
        body: ask.body,
    })
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
    worker.postMessage({
        kind: 'head',
        id: ask.id,
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        empty: body === null,
    })
    if (body === null) return
    bodies.set(ask.id, {
        reader: body.getReader(),
        html: (response.headers.get('content-type') ?? '').startsWith(
            'text/html',
        ),
    })
}

// ONE CHUNK PER ASK, transferred rather than copied. A throw in the middle ends the stream in an
// error, as `abide start` does (41.16) — and where the answer is a page, what broke goes out as markup
// first. `render` flushes the head before a page's module is imported (41.1), so a page that does not
// parse fails HERE, after the status has gone, and a reader shown a blank tab is told nothing.
async function pull(id: number): Promise<void> {
    const reading = bodies.get(id)
    if (reading === undefined) return
    try {
        const { done, value } = await reading.reader.read()
        if (done) {
            bodies.delete(id)
            worker.postMessage({ kind: 'end', id })
            return
        }
        // COPIED, THEN TRANSFERRED. A chunk may be a view on a buffer its producer still owns — a
        // compressor's `Buffer` is a slice of a shared pool, and `Buffer#slice` copies nothing — so
        // handing over `value.buffer` sent the whole pool and detached it under the producer.
        const bytes = new Uint8Array(value).buffer as ArrayBuffer
        worker.postMessage({ kind: 'chunk', id, bytes }, [bytes])
    } catch (thrown) {
        bodies.delete(id)
        const why = describe(thrown)
        if (reading.html) {
            const shown = new TextEncoder().encode(failureMarkup(why))
                .buffer as ArrayBuffer
            worker.postMessage({ kind: 'chunk', id, bytes: shown }, [shown])
        }
        worker.postMessage({ kind: 'fail', id, message: why })
    }
}

function describe(thrown: unknown): string {
    return thrown instanceof Error
        ? (thrown.stack ?? thrown.message)
        : String(thrown)
}

// The app, compiled and wired. A throw anywhere in here leaves `app` undefined and the message in
// `failure`, which is what 38.4 asks for: the command keeps answering, and what it answers says
// what is wrong.
async function open(
    start: Extract<ToWorker, { kind: 'start' }>,
): Promise<void> {
    app = undefined
    mux = undefined
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
        // them asks it anything — and on a reload every one of them is latency the author waits on.
        //
        // ONE LISTING of the public directory, for the bundle's externals and for what is served.
        const publicDirectory = `${root}/ui/${PUBLIC_DIRECTORY}`
        const publicNames = namesUnder(publicDirectory)
        const [bundle, shell, published, [table, mounted]] = await Promise.all([
            bundleInMemory(
                root,
                base,
                // 16.29, 16.30 — the browser's view of `server/`, as `abide build` gives it.
                [plugin, fenceServer(root, start.modules)],
                paged,
                publicNames.map((name) => `/${name}`),
            ),
            shellUnder(root),
            // 38.20 — OUT OF THE SOURCE TREE. `abide build` copies these into its output and dev
            // has no output, so the address answers where the author's file actually is.
            publicFilesUnder(publicDirectory, publicNames),
            loadTables(base, root),
        ])

        // 36.13, IN THIS LANE TOO. A throw here lands in `failure`, which is what 38.4 asks
        // for: the command keeps answering and what it answers names both halves. Without it
        // `answerRequest` below would silently prefer the file — its public-before-routes
        // order rests on this collision being impossible.
        refuseAddressCollision(table.routes, published.keys(), 'abide dev')

        // 38.18 — THE RELOAD CLIENT IS THIS WORKER'S, not the bundle's, and it goes in whether or
        // not there is an entry beside it: a bundle that failed is exactly when a reader needs the
        // next save to reach them. `clientTags` writes nothing for a manifest with no entry.
        const reload = `<script type="module" src="${RELOAD_CLIENT_ADDRESS}"></script>`
        const sources = appSources(table, shell, bundle.manifest, reload, {
            framework: (pathname) => served(bundle, pathname),
            published,
            ...mounted,
        })
        mux = socketHandlers(mounted.sockets, mounted.handlers)
        // THE SAME `App` `abide start` boots, so an app's hooks and middleware run in dev too.
        app = await bootApp(root, async () => sources)
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

// 38.17 — THE CLIENT, BUILT INTO MEMORY. Unminified, and the entry named by its source rather
// than content-hashed, so what a browser loads and what a stack trace names are the module the
// author wrote. 38.5's hashes and manifest are the BUILD's, and the difference is deliberate: a
// dev chunk that changed has to be fetched again, and a name that changes with it is a cache the
// reload cannot clear.
//
// A FAILURE IS AN EMPTY BUNDLE AND NOT A THROW (38.18). The pages still render, the document
// still loads the reload client, and the next save is what fixes it.
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
        bundle.files.set(name, {
            bytes: read[index] as ArrayBuffer,
            type: output.type,
        })
    }
    // `base` AS GIVEN, with no real path taken: every route module is one the plugin served, and
    // the metafile names those under the plugin's namespace exactly as the plugin spelled them.
    bundle.manifest = chunksByModule(built.metafile as Bun.BuildMetafile, base)
    return bundle
}

// A module in the map wins; everything else is resolved from where that module PRETENDS to be,
// which is inside the app's package — so `abide`, `#ui/…` and a stylesheet all answer exactly as
// they do for a build on disk.
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
                    const beside = new URL(args.path, `file://${from}/`)
                        .pathname
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

// What a reader gets while the project does not compile: the message, and the reload client that
// brings them the fix. A document rather than a bare 500 body — the browser is where the author
// is looking, and an error only the terminal carries is one they read on the next save.
function failedDocument(why: string): Response {
    return new Response(
        `<!doctype html><html><head><meta charset="utf-8"><title>abide dev</title>
<script type="module" src="${RELOAD_CLIENT_ADDRESS}"></script></head>
<body>${failureMarkup(why)}</body></html>`,
        {
            status: 500,
            headers: { 'content-type': 'text/html; charset=utf-8' },
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
