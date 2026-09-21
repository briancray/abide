// 38.15 — THE APP, IN A WORKER. Everything an app's own code touches is in here: the modules it
// compiled to, the client bundle, and the render. The listener is on the main thread
// (`serveDev`), so replacing this worker is how a reload happens and nothing an app left behind
// — a module in the registry, a timer, a `share` — survives one.
//
// THE COMPILER IS NOT THE APP, and it stays outside: `serveDev` compiles and sends the modules
// in, so one `TypeSession` serves every reload. It is also the whole of the reload's cost —
// importing the checker into a fresh worker each time was 4.5 s against the 80 ms the compile
// itself takes.
//
// NOTHING IS WRITTEN TO DISK (38.17). The modules arrive as text and are reached through a
// plugin: `Bun.plugin` for the server modules this worker imports, and a build plugin for the
// bundle a browser fetches. The paths they are keyed under mirror the output tree `abide build`
// would have written, so a module's imports resolve the same in either.
//
// A REQUEST ARRIVES AS A MESSAGE and leaves as one. The body is collected rather than streamed,
// which is the one thing dev does differently from `abide start` — 41.1's flush is not built, so
// what is lost today is the head chunk going out ahead of the body's encode.

import {
    type AppSources,
    answerRequest,
    clientTags,
    intoHead,
    notFound,
    publicFilesUnder,
    rankRoutes,
    type ServerRoute,
} from './answerRequest.ts'
import {
    CLIENT_ADDRESS,
    CLIENT_ENTRY,
    DEV_ADDRESS,
    PUBLIC_DIRECTORY,
} from './CLIENT_BUILD.ts'
import { shellUnder } from './render.ts'

// Where the compiled modules pretend to live. Under the app's own root so that `#ui/…` and a bare
// package name resolve from here exactly as they resolve from the build tree — both sit inside
// the app's package — and under a `__abide` directory for the reason the addresses are: no app
// writes one.
const VIRTUAL_DIRECTORY = '__abide'

// The bundle this worker answers `/__abide/client/…` out of, and the type each name is served as.
type Bundle = Map<string, { bytes: ArrayBuffer; type: string }>

// What the listener sends to start this worker: the app's root, the modules it compiled to, and
// what stopped it compiling where nothing did.
type Start = {
    root: string
    modules: Map<string, string>
    failure: string
}

type Ask = {
    id: number
    method: string
    url: string
    headers: [string, string][]
    body: ArrayBuffer | null
}

const worker = self as unknown as Worker

// THE COMPILE, AS SOMETHING TO WAIT ON. A request that arrives while the worker is still
// compiling has to wait for the app rather than be told there is none: the listener forwards
// every request to the CURRENT worker the moment it replaces one, so without this the first
// request after a save is answered with the failure document for a failure that never happened.
let opening: Promise<void> | undefined

let app: AppSources | undefined
// What stopped the app compiling, kept rather than thrown: 38.4 keeps the server up and 38.18
// keeps it up through a bundle that failed, so the failure is something to SERVE.
let failure = ''

worker.onmessage = async (event: MessageEvent): Promise<void> => {
    const message = event.data as { kind: string } & Ask & Start
    if (message.kind === 'start') {
        opening = open(message)
        await opening
        worker.postMessage({ kind: 'ready', failure })
        return
    }
    if (message.kind !== 'request') return
    await opening
    const answer = await answerAsk(message)
    worker.postMessage(answer, [answer.body])
}

async function answerAsk(ask: Ask): Promise<{
    kind: 'response'
    id: number
    status: number
    headers: [string, string][]
    body: ArrayBuffer
}> {
    const request = new Request(ask.url, {
        method: ask.method,
        headers: ask.headers,
        body: ask.body,
    })
    const response =
        app === undefined
            ? failedDocument(failure)
            : await answerRequest(app, request)
    const body = await response.arrayBuffer()
    return {
        kind: 'response',
        id: ask.id,
        status: response.status,
        headers: [...response.headers.entries()] as [string, string][],
        body,
    }
}

// The app, compiled and wired. A throw anywhere in here leaves `app` undefined and the message in
// `failure`, which is what 38.4 asks for: the command keeps answering, and what it answers says
// what is wrong.
async function open(start: Start): Promise<void> {
    app = undefined
    failure = start.failure
    if (failure !== '') return
    const root = start.root
    try {
        const base = `${root}/${VIRTUAL_DIRECTORY}`
        const modules = new Map<string, string>()
        for (const [name, text] of start.modules)
            modules.set(`${base}/${name}`, text)
        const routed = modules.has(`${base}/server.ts`)

        // ONE PLUGIN, TWO CALLERS: the runtime resolves this worker's `import()` through it and
        // the bundler resolves the browser's graph through it, so the two lanes cannot disagree
        // about what a specifier means. Registering it is process-wide — which is a worker rather
        // than the command, so a reload is a new registry rather than a cache to bust.
        const plugin = virtualModules(modules)
        Bun.plugin(plugin)

        const bundle = await bundleInMemory(root, base, plugin, routed)

        const table = routed
            ? ((await import(`${base}/server.ts`)) as {
                  routes: ServerRoute[]
              })
            : { routes: [] as ServerRoute[] }

        app = {
            routes: rankRoutes(table.routes),
            shell: intoHead(
                await shellUnder(root),
                // 38.18 — THE RELOAD CLIENT IS THIS WORKER'S, not the bundle's, and it goes in
                // whether or not there is an entry beside it: a bundle that failed is exactly
                // when a reader needs the next save to reach them. What is NOT written is a tag
                // for a bundle that is not there — a `<script>` at a 404 is a console error in
                // place of the build error the terminal already carries.
                `${bundle.has(`${CLIENT_ENTRY}.js`) ? clientTags(bundle.has(`${CLIENT_ENTRY}.css`)) : ''}<script type="module" src="${DEV_ADDRESS}/client.js"></script>`,
            ),
            framework: (pathname) => served(bundle, pathname),
            // 38.20 — OUT OF THE SOURCE TREE. `abide build` copies these into its output and dev
            // has no output, so the address answers where the author's file actually is.
            published: await publicFilesUnder(`${root}/ui/${PUBLIC_DIRECTORY}`),
        }
    } catch (thrown) {
        failure = thrown instanceof Error ? thrown.message : String(thrown)
    }
}

function served(bundle: Bundle, pathname: string): Response | undefined {
    if (pathname === `${DEV_ADDRESS}/client.js`)
        return new Response(RELOAD_CLIENT, {
            headers: {
                'content-type': 'text/javascript; charset=utf-8',
                'cache-control': 'no-store',
            },
        })
    if (!pathname.startsWith(`${CLIENT_ADDRESS}/`)) return notFound()
    const found = bundle.get(pathname.slice(CLIENT_ADDRESS.length + 1))
    if (found === undefined) return notFound()
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
    plugin: Bun.BunPlugin,
    routed: boolean,
): Promise<Bundle> {
    const bundle: Bundle = new Map()
    if (!routed) return bundle
    const built = await Bun.build({
        entrypoints: [`${base}/${CLIENT_ENTRY}.ts`],
        // The app's own root, because `Bun.build` opens this directory and a virtual one is not
        // there to open. What it decides is where the output names are rooted, and the naming
        // below makes them flat anyway.
        root,
        plugins: [plugin],
        target: 'browser',
        format: 'esm',
        splitting: true,
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
    for (const output of built.outputs) {
        const name = output.path.slice(output.path.lastIndexOf('/') + 1)
        bundle.set(name, {
            bytes: await output.arrayBuffer(),
            type: output.type,
        })
    }
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
            build.onLoad({ filter: /.*/, namespace: 'abide-dev' }, (args) => ({
                contents: modules.get(args.path) ?? '',
                loader: 'ts',
            }))
        },
    }
}

// What a reader gets while the project does not compile: the message, and the reload client that
// brings them the fix. A document rather than a bare 500 body — the browser is where the author
// is looking, and an error only the terminal carries is one they read on the next save.
function failedDocument(why: string): Response {
    return new Response(
        `<!doctype html><html><head><meta charset="utf-8"><title>abide dev</title>
<script type="module" src="${DEV_ADDRESS}/client.js"></script></head>
<body><main><h1>abide dev</h1><pre>${escapeForDocument(why)}</pre></main></body></html>`,
        {
            status: 500,
            headers: { 'content-type': 'text/html; charset=utf-8' },
        },
    )
}

function escapeForDocument(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
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
