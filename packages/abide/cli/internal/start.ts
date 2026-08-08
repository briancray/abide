// `abide start` — the app, served against what `abide build` wrote.
//
// An app is four conventions and no wiring: `app.ts` says what this app IS, `app.html` is the
// document it is served in, `pages/` is what it serves, `server/rpc/**` and `server/sockets/**` are
// what it answers, and `client.ts` is the lane the browser gets. Nothing in any of them imports a
// server, calls `Bun.serve`, mounts `dispatch`, installs a signal handler, matches a route, builds a
// document or imports a handler for its side effect — every one of those is the same code in every
// app, and the one an app forgets is the one that matters.
//
// So `app.ts` exports HOOKS, and a route only if it wants one. Nothing here is a decision an app has
// to restate: a pages directory is a route table, a transport directory is the endpoints, the
// request's own URL is what matched it, and the shell is the file the app already wrote. What is left
// for an app to say is the part that is actually its own.
//
// Four layers, and the ORDER is the whole design:
//
//   the client bundle   files on a disk, in front of everything, because it is not an endpoint and a
//                       page waiting on an auth rung for its own JavaScript is a page that cannot log
//                       in. Outside the request scope too: a static file has no caller to be about
//   /__abide/**         `dispatch`, which `handle` already puts in front of the app's routes
//   the app's route     the default export, if it has one, wrapped in its own middleware onion
//   the pages           whatever the app did not answer, rendered into its shell. `undefined` here
//                       is a 404, and an app with no pages is one made of endpoints
//
// PRODUCTION, and the sense in which that is a real word here: the bundle is read off a disk rather
// than built, `--port` binds and fails rather than hopping, and `development` is off so a stack trace
// is a log line rather than a response body. `abide dev` is the other half — the same four layers
// with a bundler and a watcher behind the first one.

import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
// The `.abide` loader, registered by importing the module that owns the registration — the same one
// `abide run` preloads and `abide repl` makes. An app importing a page compiles it on the way in.
import '$compiler/preload.ts'
import { type Config, type ConfigDefaults, config, isPort, onConfig } from '$server/config.ts'
import { type HealthReporter, onHealth } from '$server/health.ts'
import { type IdentityResolver, onIdentity } from '$server/identity.ts'
import { documentToStream } from '$server/index.ts'
import {
    boot,
    type ErrorHook,
    handle,
    type Middleware,
    middleware,
    onError,
    onStart,
    onStop,
    type Route,
    type StartHook,
    type StopHook,
} from '$server/lifecycle.ts'
import { pages } from '$server/pages.ts'
import { registered, websocket } from '$server/registry.ts'
import { page } from '$server/responses.ts'
import type { Schema } from '$server/schema.ts'
import type { Shell } from '$server/shell.ts'
import { outlet, type RouteEntry, route as routeAsked, routes } from '$shared/index.ts'
import { isThenable, messageOf } from '$shared/internal/probes.ts'
import { appName } from '$shared/log.ts'
import { readying } from '$shared/router.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import {
    CLIENT_DIR,
    CLIENT_ENTRIES,
    CLIENT_ROUTE,
    type ClientManifest,
    firstPresent,
} from '../CLIENT_BUILD.ts'
import { type ClientAssets, clientAssets, type LoadedClient } from './assets.ts'
import { handlers } from './handlers.ts'
import { BOLD, colored, DIM, paint, plural } from './paint.ts'
import { APP_HTML, type AppShell, appShell } from './shell.ts'

/**
 * What an app IS, in the order it is looked for — `app.ts` beside the `app.html` it is served in and
 * the `client.ts` the browser gets. One name for the app, spelled once per lane.
 *
 * No `.abide` here, where the client list has one: a `.abide` file compiles to a COMPONENT, and this
 * module is asked for hooks. A `.abide` app entry would be a page with nowhere to be served from.
 */
const CONVENTIONAL = ['app.ts', 'app.tsx', 'app.js']

/** Where the pages are. A directory rather than a declaration — the tree IS the route table. */
const PAGES = 'pages'

/** Hoisted: the render reads it once and keeps nothing, so a literal here would be per request. */
const HYDRATABLE = { hydratable: true }

export async function start(argv: string[]): Promise<number> {
    const asked = portFrom(argv)
    if (typeof asked === 'string') {
        console.error(`abide start: ${asked}`)
        console.error('       usage: abide start [--port <n>]')
        return CLI_EXIT_CODES.usage
    }
    // Spelled as the VARIABLE, before anything resolves the document. `config()` is the one answer to
    // what this process is running on, so a flag that kept its own number beside it would be a second
    // one — and the app's own `PORT` default would go on being reported by `config().PORT` while the
    // socket sat somewhere else. Declared here, the flag beats an app's `onConfig` default exactly as
    // an operator's variable does, which is the same rule stated once.
    if (asked !== null) process.env.PORT = String(asked)

    const root = process.cwd()
    const entry = await firstPresent(root, CONVENTIONAL)
    if (entry === null) {
        console.error(`abide start: no app here — expected one of ${CONVENTIONAL.join(', ')}`)
        console.error(`       an app is a module exporting its hooks, beside a ${PAGES}/ directory; ${root}`)
        return CLI_EXIT_CODES.usage
    }

    let built: LoadedClient | null
    try {
        built = await clientAssets(root)
    } catch (failure) {
        console.error(`abide start: ${CLIENT_DIR} is there and cannot be read — ${messageOf(failure)}`)
        return CLI_EXIT_CODES.failed
    }
    const assets = built?.assets ?? null
    if (built === null && (await firstPresent(root, CLIENT_ENTRIES)) !== null) {
        // A client entry with no build is the one shape that is unambiguously a mistake: somebody
        // wrote the lane and the bundle is not there, so every `<script>` the pages emit would 404.
        // An app with no client entry at all is not this — it is an app made of endpoints, and it
        // starts.
        console.error(`abide start: a client entry is here and ${CLIENT_DIR} is not — run \`abide build\``)
        return CLI_EXIT_CODES.failed
    }

    // The endpoints FIRST, so everything under `/__abide/` is registered before a line of the app's
    // own module runs — an `onStart` that calls one of its own handlers is calling something that is
    // already there, and no file has to import another for its side effect.
    try {
        await handlers(root)
    } catch (failure) {
        console.error(`abide start: a handler did not load — ${messageOf(failure)}`)
        return CLI_EXIT_CODES.failed
    }

    let app: AppModule
    try {
        app = (await import(Bun.pathToFileURL(entry).href)) as AppModule
    } catch (failure) {
        // The import ran the app's module body, so this is as likely to be the app's own top-level
        // work failing as it is to be a syntax error. Either way it never bound a socket.
        console.error(`abide start: ${entry} did not load — ${messageOf(failure)}`)
        return CLI_EXIT_CODES.failed
    }

    const declared = wire(app)
    if (typeof declared === 'string') {
        console.error(`abide start: ${entry} ${declared}`)
        return CLI_EXIT_CODES.failed
    }

    // The pages and the document they render in — both read ONCE, here, because neither can change
    // under a running process and a shell parsed per request would be a file re-read per page view.
    let paged: Paged | null
    let serving: Route
    try {
        paged = await pageLayer(root, built?.manifest ?? null)
        serving = composed(declared, paged)
    } catch (failure) {
        // An `app.html` with nowhere to render is the loud one, and it is caught HERE rather than on
        // the first page view: a shell somebody mistyped should be a process that does not come up.
        console.error(`abide start: ${messageOf(failure)}`)
        return CLI_EXIT_CODES.failed
    }

    const handled = handle(serving)
    // Two shapes rather than one that tests `assets` per request: a process either has a bundle for
    // its whole life or it does not, and this is the outermost function on every request the app
    // takes.
    const answer =
        assets === null
            ? handled
            : (request: Request, server: Parameters<typeof handled>[1]): ReturnType<typeof handled> =>
                  assets.serve(request) ?? handled(request, server)

    // `config()`, not the flag: an app that declared its own default gets it, and the floor is 3000.
    // Taken as it is, because the document already resolved it as a PORT — however it was named, by a
    // variable or by an app's `onConfig` default. A floor here would be a third rule for one number.
    const port = config().PORT

    let running: Awaited<ReturnType<typeof boot<ReturnType<typeof Bun.serve>>>>
    try {
        running = await boot(() =>
            Bun.serve({
                port,
                // Off, deliberately. Bun's development mode answers an uncaught throw with a page
                // describing the stack, which is a debugging tool and an information leak in the same
                // response. `onError` is where an app decides what a failure looks like here.
                development: false,
                fetch: answer,
                websocket,
            }),
        )
    } catch (failure) {
        return refused(failure, port)
    }
    // `boot` says so on `abide:lifecycle` — an `onStart` that returned without calling `start()` is
    // the app deciding this process should not serve, so it is an outcome rather than a failure.
    if (running === null) return CLI_EXIT_CODES.ok

    report(running.url.href, entry, paged, assets)

    // A server command has no number to answer with. The process ends when it is SIGNALLED, and the
    // handler that ends it is `boot`'s — so returning an exit code here would have `cli` hand one to
    // `process.exit` while the socket is still listening.
    return new Promise<number>(() => {})
}

// --- the pages, and the document they are served in --------------------------

/** The pages and the document they render in. One value, because neither is read without the other. */
interface Paged {
    table: RouteEntry[]
    shell: AppShell
}

/**
 * The pages directory as a route table and the shell it renders in, or `null` when this app has none.
 *
 * `null` rather than an empty table, because the two mean different things to everything downstream:
 * no directory is an app made of endpoints and needs no shell, where an empty one is an app whose
 * pages have not been written yet and should still serve its own document.
 */
async function pageLayer(root: string, manifest: ClientManifest | null): Promise<Paged | null> {
    const directory = `${root}/${PAGES}`
    try {
        if (!(await stat(directory)).isDirectory()) return null
    } catch {
        return null
    }
    return { table: await pages(directory), shell: await appShell(root, manifest, appName()) }
}

/**
 * The app's own route with the pages behind it, or whichever of the two exists.
 *
 * The app goes FIRST and `undefined` is what hands over, which is the same word `handle` reads as a
 * 404 — so an app that wants a path the pages directory also claims simply answers it, and one that
 * wants none writes no default export at all. Composed once at boot: an app with no route of its own
 * gets the renderer itself, rather than a wrapper testing for it per request.
 */
function composed(declared: Route | null, paged: Paged | null): Route {
    // Nothing of its own and nothing to render: every path is then `handle`'s 404, which is an app
    // made entirely of endpoints.
    if (paged === null) return declared ?? ((): undefined => undefined)
    routes(paged.table)
    const rendered = renderer(paged.shell.parts)
    if (declared === null) return rendered
    return (request: Request, server: Parameters<Route>[1]): ReturnType<Route> => {
        const answered = declared(request, server)
        if (answered === undefined) return rendered(request)
        if (isThenable(answered)) return answered.then((settled) => settled ?? rendered(request))
        return answered
    }
}

/**
 * One page, in the app's shell.
 *
 * There is nothing to match: `handle` opened the request scope, so `route()` already answers off this
 * request's own URL — which is why a page is served without the app writing a router, and why the
 * same `outlet()` renders here and hydrates in the browser.
 *
 * STREAMED, so a browser has the head and can start fetching the bundle while the body is still being
 * written. The scope follows it: the ambients ride the async context an `await` already carries, and
 * `documentToStream` holds the scope itself until the last chunk, so a `memo` read halfway down the
 * page is still this caller's one cache rather than a second build of the same answer.
 */
function renderer(shell: Shell): (request: Request) => Promise<Response | undefined> {
    return async (request: Request): Promise<Response | undefined> => {
        // A page is a READ. Anything else against the same path is the app's to answer, and a 404
        // when it did not.
        if (request.method !== 'GET' && request.method !== 'HEAD') return undefined
        // `kind`, which is the router's own word for "nothing matched" — the empty name it is derived
        // from is that module's encoding rather than a fact this one may read.
        if (routeAsked().kind === 'missing') return undefined

        // The page's module, before the walk that renders it: a render is a snapshot, and a module
        // that has not arrived is not a tree. `readying` rather than `ready`, because after the first
        // view of a route there is nothing left to load — and an `await` on the settled promise
        // `ready()` hands back would be a microtask tick charged to every page this process serves.
        const loading = readying()
        if (loading !== null) await loading

        return page(documentToStream(shell, outlet, HYDRATABLE))
    }
}

// --- what an app's module says about itself ----------------------------------

/**
 * Every export this binary reads. `unknown` throughout, because a module is whatever it was written
 * as — the checks below are what turn that into the registrations and the route.
 */
interface AppModule {
    default?: unknown
    middleware?: unknown
    onStart?: unknown
    onStop?: unknown
    onError?: unknown
    onConfig?: unknown
    onHealth?: unknown
    onIdentity?: unknown
}

/**
 * Hand each export to the function of the same name, and answer with the app's route.
 *
 * A string back is a refusal naming what is wrong, and every export is checked BEFORE any of it takes
 * effect: an app that exported `middleware` as one function rather than an array should be told that
 * rather than have its auth rung silently not run. Wrong SHAPE is the failure worth catching here —
 * an export that is simply absent is an app that did not want that hook.
 *
 * `onConfig` is registered like the rest and lands before `boot` asks for the document, which is what
 * makes a config an app cannot resolve a process that never listens.
 */
function wire(app: AppModule): Route | null | string {
    const wrong: string[] = []
    const rungs = app.middleware
    if (rungs !== undefined && !Array.isArray(rungs)) wrong.push('`middleware` must be an array of rungs')
    for (const [name] of HOOKS) {
        const hook = app[name]
        if (hook !== undefined && typeof hook !== 'function') wrong.push(`\`${name}\` must be a function`)
    }
    // Last, so `wrong` is complete either way and one message carries every complaint.
    const route = routeOf(app.default)
    if (route === undefined) {
        wrong.push(
            '`export default` must be a route — `(request, server) => Response | undefined` — or `{ fetch }`',
        )
    }
    // `route === undefined` again rather than only `wrong.length`, because it is what narrows the
    // return below to a `Route` without a cast asserting what was just checked.
    if (wrong.length > 0 || route === undefined) return `exports what this cannot read: ${wrong.join('; ')}`

    if (Array.isArray(rungs)) middleware(...(rungs as Middleware[]))
    for (const [name, register] of HOOKS) {
        const hook = app[name]
        if (hook !== undefined) register(hook)
    }
    return route
}

/**
 * Every hook an app may export, beside the function it is handed to.
 *
 * ONE table rather than a list to validate against and a block to register from, because those two
 * kept in step by hand is exactly the failure this file exists to remove: a name added to one and
 * not the other is an export that checks out and is never registered, with nothing said about it.
 */
const HOOKS: readonly (readonly [keyof AppModule, (hook: unknown) => void])[] = [
    ['onStart', (hook) => onStart(hook as StartHook)],
    ['onStop', (hook) => onStop(hook as StopHook)],
    ['onError', (hook) => onError(hook as ErrorHook)],
    [
        'onConfig',
        (hook) => {
            // The schema rides on the hook, because `onConfig` takes two things and a module export
            // is one. An app that would rather say it in a sentence calls `onConfig(fn, { schema })`
            // itself at module scope — the registration is on `abide/server` and this is sugar over
            // it, exactly as `x.set(v)` stays spellable under the template sugar.
            const schema = (hook as { schema?: Schema<Config> }).schema
            onConfig(hook as ConfigDefaults, schema === undefined ? undefined : { schema })
        },
    ],
    ['onHealth', (hook) => onHealth(hook as HealthReporter)],
    ['onIdentity', (hook) => onIdentity(hook as IdentityResolver)],
]

/**
 * The default export as a route: the function, the `fetch` of an object, or nothing at all.
 *
 * `{ fetch }` is here because it is what Bun's own entry points look like, so an app run directly by
 * `bun` and one served by `abide start` read as one module. `null` is an app that exported no route —
 * legitimate, and made entirely of endpoints. `undefined` is an export that was something else.
 */
function routeOf(exported: unknown): Route | null | undefined {
    if (exported === undefined) return null
    if (typeof exported === 'function') return exported as Route
    if (typeof exported === 'object' && exported !== null) {
        const fetch = (exported as { fetch?: unknown }).fetch
        // Bound, because a method written on an object literal may read `this` — and a route reached
        // through a variable would then be the one thing in an app that works differently for having
        // been passed somewhere.
        if (typeof fetch === 'function') return (fetch as Route).bind(exported)
    }
    return undefined
}

// --- the arguments, the refusals and the report ------------------------------

/**
 * The port a command line asked for: a number, `null` for nothing asked, a message for a mistake.
 *
 * `0` is a legal answer and means "whatever is free" — the kernel's own spelling, and what a test or
 * a container with a port already mapped for it wants. Everything else is checked as a PORT rather
 * than as a number, because `--port 70000` is a typo that would otherwise be found by a bind failing.
 */
function portFrom(argv: string[]): number | null | string {
    let asked: number | null = null
    for (let at = 0; at < argv.length; at++) {
        const argument = argv[at] as string
        let raw: string | undefined
        if (argument === '--port') raw = argv[++at]
        else if (argument.startsWith('--port=')) raw = argument.slice('--port='.length)
        else return `unknown option \`${argument}\``
        if (raw === undefined) return '`--port` needs a number'
        const port = Number(raw)
        // The same predicate `PORT` is read against, so a number this refuses is not one an operator
        // can get past by spelling it as a variable, and vice versa.
        if (!isPort(port)) return `\`${raw}\` is not a port`
        asked = port
    }
    return asked
}

/**
 * A bind that did not happen.
 *
 * A port in use is the one failure with something to say beyond the message, and it is HARD here on
 * purpose: `abide dev` hops to the next free port because a developer wants the thing to come up, and
 * a deploy that quietly listened somewhere else is a health check passing against the process it was
 * meant to replace. The `--port` this was given is the port or it is nothing.
 */
function refused(failure: unknown, port: number): number {
    if ((failure as { code?: string }).code === 'EADDRINUSE') {
        console.error(`abide start: port ${port} is already in use`)
        console.error('       stop what is on it, or name another with `--port <n>`')
    } else {
        console.error(`abide start: ${messageOf(failure)}`)
    }
    return CLI_EXIT_CODES.failed
}

/**
 * Two lines: where it is listening, and what it is serving.
 *
 * The URL is FIRST and on its own, because it is the one thing anybody reads — and because something
 * watching this process (a test, a supervisor, a dev script) should not have to parse a banner to
 * learn the address. The endpoint counts are on the second line for the question they answer: a
 * transport module that was never imported registers nothing, and `0 rpc` is what that looks like.
 */
function report(url: string, entry: string, paged: Paged | null, assets: ClientAssets | null): void {
    const on = colored()
    console.log(`listening ${paint(url, BOLD, on)}`)

    const parts = [basename(entry)]
    if (paged !== null) {
        // The shell is named because it is the one convention an app can have without knowing: a
        // process saying `app.html` when the author wrote `App.html` is the shortest way to find out
        // that the file is not being read.
        const where = paged.shell.own ? APP_HTML : "abide's shell"
        parts.push(`${plural(paged.table.length, 'page')} in ${where}`)
    }
    const rpcs = registered('rpc').length
    const sockets = registered('socket').length
    // `rpc` is the one count with no plural, which is why this is not a loop over the three.
    if (rpcs > 0) parts.push(`${rpcs} rpc`)
    if (sockets > 0) parts.push(plural(sockets, 'socket'))
    parts.push(assets === null ? 'no client bundle' : `${plural(assets.count, 'file')} at ${CLIENT_ROUTE}`)
    console.log(paint(`  ${parts.join(' · ')}`, DIM, on))
}
