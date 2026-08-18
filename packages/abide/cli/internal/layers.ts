// The layers an abide app is served in, assembled once — the half `abide start` and `abide dev`
// have in common.
//
// An app is a handful of conventions and no wiring, and `LAYOUT.ts` is where every one of them is
// written down: `src/server/app.ts` says what this app IS, `src/ui/app.html` is the document it is
// served in, `src/ui/pages/` is what it serves, `src/ui/public/` is what it hands over unchanged, and
// `src/server/rpc/**` and `src/server/sockets/**` are what it answers. The browser's lane is not one
// of them — it is GENERATED from the pages, because a route table is already on disk and only the
// browser cannot read it. Nothing in any of them imports a server, calls `Bun.serve`, mounts
// `dispatch`, installs a signal handler, matches a route, builds a document or imports a handler for
// its side effect — every one of those is the same code in every app, and the one an app forgets is
// the one that matters.
//
// So `app.ts` exports HOOKS, and a route only if it wants one — and an app with none of either writes
// no `app.ts` at all. Every export it could hold is optional, so a file holding none of them says
// nothing, and a convention that can be empty is one an app should not have to write. What makes a
// directory an app is having something to SERVE: pages, endpoints, or a module that says otherwise.
//
// Nothing here is a decision an app has to restate: a pages directory is a route table, a transport
// directory is the endpoints, the request's own URL is what matched it, and the shell is the file the
// app already wrote. What is left for an app to say is the part that is actually its own.
//
// The ORDER is the whole design:
//
//   the client bundle   files, in front of everything, because it is not an endpoint and a page
//                       waiting on an auth rung for its own JavaScript is a page that cannot log in.
//                       Outside the request scope too: a static file has no caller to be about
//   the public files    the same rule for the files an author dropped in a directory — a favicon has
//                       no caller either, and its addresses are the ones abide did not choose, so it
//                       is asked SECOND and cannot shadow anything under the reserved prefix
//   the middleware      the app's onion, around EVERYTHING below — `/__abide/**` included, so an
//                       auth rung covers the endpoints and the sockets and not only the pages
//   /__abide/**         `dispatch`, which `handle` asks before the app's own route
//   the app's route     the default export, if it has one
//   the pages           whatever the app did not answer, rendered into its shell. `undefined` here
//                       is a 404, and an app with no pages is one made of endpoints
//
// What is NOT decided here is what the two commands actually differ about: where the bundle came
// from, and how the socket is bound. `abide start` reads a build off a disk and binds HARD; `abide
// dev` builds into memory, injects its reload client into the shell and HOPS. Everything above that
// seam is one assembly, so a layer that changes shape cannot change shape in only one of them.

// `node:path` stands in for nothing: Bun ships no path api, and the builtin IS the supported one.
import { basename } from 'node:path'
// `Bun.gzipSync` is what these stand in for and cannot serve: it compresses a whole BUFFER, and a
// streamed document is the one thing that does not have one. There is no flushing compressor on
// `Bun.*` — see `compressed`, which needs a block ended at every write. `Duplex.toWeb` is the bridge
// back from that node stream to the web `ReadableStream` a `Response` is built from.
import { Duplex } from 'node:stream'
import { constants, createGzip } from 'node:zlib'
// The `.abide` loader, registered by importing the module that owns the registration — the same one
// `abide run` preloads and `abide repl` makes. An app importing a page compiles it on the way in.
import '#compiler/preload.ts'
// Where an app puts things, by its one definition — the module names for the entry this looks for,
// and the public directory for the layer below. A leaf of strings, so naming it costs nothing.
import { APP_MODULES, PUBLIC_DIR } from '#compiler/LAYOUT.ts'
// The transport directories by their one definition, for the refusal that names them. The globs come
// from the compiler rather than being written again here, exactly as the boot's own scan takes them.
import { TRANSPORT_ROOTS } from '#compiler/TRANSPORT.ts'
import { isPort } from '#server/config.ts'
import { documentToStream, fragmentToStream } from '#server/render.ts'
import { boot, handle, type Route } from '#server/lifecycle.ts'
import { type PageFiles, pages, pagesFrom } from '#server/pages.ts'
import { registered } from '#server/catalogue.ts'
import { websocket } from '#server/registry.ts'
import { page } from '#server/responses.ts'
import { type Shell, useAppDocument } from '#server/shell.ts'
import { mounted } from '#shared/internal/mount.ts'
import {
    NAVIGATION_DEPTH_HEADER,
    NAVIGATION_FAILURE_HEADER,
    NAVIGATION_FROM_HEADER,
    NAVIGATION_HEADER,
} from '#shared/internal/PATHS.ts'
import { isThenable, messageOf } from '#shared/internal/probes.ts'
import { JSON_TYPE, statusOf } from '#shared/internal/wire.ts'
import { appName } from '#shared/log.ts'
import {
    errorFor,
    errorOutlet,
    errorReady,
    type Failure,
    failureHeader,
    type Loader,
    outlet,
    outletFrom,
    type RouteEntry,
    readying,
    route as routeAsked,
    routes,
    sharedLayoutDepth,
} from '#shared/router.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { CLIENT_ROUTE, type ClientGraph, type ClientManifest, firstPresent, PAGES } from '../CLIENT_BUILD.ts'
import { refuse } from '../COMMANDS.ts'
import type { ClientAssets, LoadedClient } from './assets.ts'
import { acceptedEncoding } from './encodings.ts'
import { handlers } from './handlers.ts'
import { BOLD, colored, DIM, paint, plural } from './paint.ts'
import { type PublicFiles, publicFiles } from './publics.ts'
import { APP_HTML, type AppShell, appShell } from './shell.ts'

/** Hoisted: the render reads it once and keeps nothing, so a literal here would be per request. */
const HYDRATABLE = { hydrate: true }

/** What answers a request: the bundle in front, then `handle`'s pipeline. What `Bun.serve` is given. */
export type Answer = ReturnType<typeof handle>

/** What a command tells this about the app it is assembling. */
export interface Assembling {
    root: string
    /**
     * What a refusal is prefixed with — `abide start`, `abide dev`.
     *
     * The messages are written ONCE here rather than per command, because they are all about the
     * same four conventions: a directory with nothing to serve is the same mistake whichever command
     * found it, and the two drifting apart is a fix applied to whichever one somebody hit first.
     */
    label: string
    /**
     * The bundle, however it was produced. `null` is an app with no client lane.
     *
     * A PROMISE is welcome and `abide dev` hands one: building the client and importing the app read
     * nothing of each other, and nothing here reads the bundle until the shell is cut — so the build
     * overlaps the import rather than following it, on every save. Guarded rather than awaited, so
     * `abide start`'s already-settled value costs no tick.
     */
    client: LoadedClient | null | Promise<LoadedClient | null>
    /** Appended to the end of the shell's head. The tag naming `abide dev`'s reload client, and nothing more. */
    head?: string
    /**
     * The pages walk, when the caller already did one — `abide dev` does, to generate the client
     * entry from the same list on the same save. Absent means "scan it here", which is `abide start`.
     */
    pages?: PageFiles[]
    /**
     * The app as a COMPILE saw it, for a process that has no directory to look in.
     *
     * Everything else in this file reads a tree: the entry is found by probing four names, the
     * handlers by a glob, the pages by a walk, the shell and the public files by reading them. A
     * standalone binary has none of that, so `abide compile` asks the same four questions AT BUILD
     * TIME and writes the answers into the entry it compiles — see `internal/binary.ts`.
     *
     * One field rather than five loose ones because it is one fact and they are all-or-nothing: an
     * image that named its pages and not its handlers would assemble half an app out of a tree that
     * is not there.
     */
    image?: AppImage
}

/**
 * An app that is not a directory — what a compiled binary carries.
 *
 * The same shapes the scans produce, which is the point: past `assemble`, nothing downstream can tell
 * the two apart, so a binary serves the app through the code that serves it under `abide start`
 * rather than through a second renderer that agrees with it today.
 */
export interface AppImage {
    /** What `app.ts` exported, ALREADY imported. `null` for an app that wrote no module of its own. */
    app: AppModule | null
    /** Its filename, for the report — the compile's answer to `firstPresent`. */
    entry: string | null
    /** How many transport modules the compile imported, which is what `handlers()` would have counted. */
    endpoints: number
    /** The pages, or `null` for an app made of endpoints. */
    pages: ImagedPages | null
    /** The public files, embedded and ready to serve. `null` for an app with no public directory. */
    publics: PublicFiles | null
}

/** A pages directory as a compile recorded it: the walk, a loader per file, and the document. */
interface ImagedPages {
    files: PageFiles[]
    /** One `import()` thunk per file in `files`, keyed by the same relative path — see `pagesFrom`. */
    loaders: Record<string, Loader>
    /** `app.html` as text, or `null` for an app that wrote none and gets abide's. */
    html: string | null
}

/** The assembled app: what serves it, and the three facts the report is built from. */
export interface Assembly {
    /** `null` for an app that wrote no module of its own — pages and endpoints are the whole of it. */
    entry: string | null
    paged: Paged | null
    /** The bundle this was assembled WITH, so a report cannot describe a different one. */
    assets: ClientAssets | null
    /** The public directory, for the same reason — `null` for an app that has none. */
    publics: PublicFiles | null
    answer: Answer
}

/**
 * The app at `root`, ready to be handed a socket — or the exit code of a refusal already PRINTED.
 *
 * A number back rather than a throw, because every failure here is one an operator has to read and
 * act on rather than one a stack trace helps with: a missing `app.ts`, an export of the wrong shape,
 * an `app.html` with nowhere to render. `usage` for a command pointed at the wrong directory and
 * `failed` for an app that is there and broken — the same split every other command makes.
 */
export async function assemble(asked: Assembling): Promise<Assembly | number> {
    const { root, label, image } = asked

    const entry = image === undefined ? await firstPresent(root, APP_MODULES) : image.entry

    // The endpoints FIRST, so everything under `/__abide/` is registered before a line of the app's
    // own module runs — an `onStart` that calls one of its own handlers is calling something that is
    // already there, and no file has to import another for its side effect.
    // An image is past that already: the modules are static imports of the entry this binary was
    // compiled from, so they registered before anything here ran, and the count is what the compile
    // saw.
    let answering: number
    if (image !== undefined) answering = image.endpoints
    else {
        try {
            answering = await handlers(root)
        } catch (failure) {
            console.error(`${label}: a handler did not load — ${messageOf(failure)}`)
            return CLI_EXIT_CODES.failed
        }
    }

    // No module is an app that said nothing about itself, which is every default: no route of its
    // own, no hooks, and the pages and endpoints below unchanged by its absence.
    //
    // IMPORTING IS WHAT REGISTERS: the module's own `onStart(…)` / `middleware(…)` calls run in its
    // body, so a hook that throws on the way in is the same failure as a syntax error and lands in
    // the same catch. Nothing is read off the namespace but the route.
    let declared: Route | null = null
    if (entry !== null) {
        let app: AppModule
        if (image !== undefined) app = image.app as AppModule
        else {
            try {
                app = (await import(Bun.pathToFileURL(entry).href)) as AppModule
            } catch (failure) {
                // The import ran the app's module body, so this is as likely to be the app's own
                // top-level work failing as it is to be a syntax error. Either way it never bound a
                // socket.
                console.error(`${label}: ${entry} did not load — ${messageOf(failure)}`)
                return CLI_EXIT_CODES.failed
            }
        }
        // `undefined` is an export that was something else; `null` is an app that exported no route.
        const route = routeOf(app.default)
        if (route === undefined) {
            console.error(
                `${label}: ${entry} \`export default\` must be a route — \`(request, server) => Response | undefined\` — or \`{ fetch }\``,
            )
            return CLI_EXIT_CODES.failed
        }
        declared = route
    }

    // The pages and the document they render in — both read ONCE, here, because neither can change
    // under a running process and a shell parsed per request would be a file re-read per page view.
    // The bundle is settled first because the shell is where its names are read.
    let paged: Paged | null
    let serving: Route
    let built: LoadedClient | null
    let publics: PublicFiles | null
    try {
        // Started before the bundle is waited on: the public directory has no bearing on either, so
        // its scan overlaps the build rather than following the pages walk.
        // An image did both at compile time, so there is nothing here to overlap.
        const reading = image === undefined ? publicFiles(root) : image.publics
        built = isThenable(asked.client) ? await asked.client : asked.client
        // The app's own document, for EVERY app rather than only a paged one: `render(view, { shell:
        // true })` is a route asking for it, and an app made of endpoints has one to give. Read once
        // here, because it cannot change under a running process — and published before anything is
        // serving, since the first request is where a route would ask.
        //
        // In the image lane there is no file to read: `pages` is `null` for a binary made of
        // endpoints, which is that compile saying the app wrote no document rather than this process
        // being asked to look for one.
        const document = await appShell(
            root,
            built?.manifest ?? null,
            appName(),
            image === undefined ? undefined : (image.pages?.html ?? null),
        )
        useAppDocument({ parts: document.parts, lane: document.lane })
        paged = await pageLayer(root, document, asked.head, asked.pages, image?.pages)
        // Guarded rather than awaited: in the image lane `reading` is already the value, and an
        // unconditional await there is a promise wrap and a tick for nothing.
        publics = isThenable(reading) ? await reading : reading
        serving = composed(declared, paged, built?.manifest ?? null)
    } catch (failure) {
        // An `app.html` with nowhere to render is the loud one, and it is caught HERE rather than on
        // the first page view: a shell somebody mistyped should be a process that does not come up.
        console.error(`${label}: ${messageOf(failure)}`)
        return CLI_EXIT_CODES.failed
    }

    // Nothing to serve, nothing to answer and nothing said: a command pointed at the wrong directory,
    // which is the case the missing-`app.ts` refusal was really about. Asked of what was FOUND rather
    // than of the file that used to stand for all three — the scan and the page layer have both run,
    // so this is the app's own emptiness rather than a stat guessing at it.
    //
    // The scan's own count rather than the registry's, which holds this COMMAND's endpoints too:
    // `abide dev` registers its reload socket before assembling, and an empty directory reading as
    // "1 socket" is a supervisor watching a tree with nothing in it.
    if (entry === null && paged === null && answering === 0) {
        console.error(`${label}: no app here — nothing to serve in ${root}`)
        const transports = Object.values(TRANSPORT_ROOTS).join(', ')
        console.error(`       an app is a ${PAGES}/ directory, handlers under ${transports}, or one of`)
        console.error(`       ${APP_MODULES.join(', ')} exporting its hooks`)
        return CLI_EXIT_CODES.usage
    }

    const handled = handle(serving)
    const assets = built?.assets ?? null
    // The static layers this process actually HAS, in the order they are asked: the bundle first,
    // because its addresses are all under one reserved prefix and cannot collide with anything an
    // author put in a directory.
    //
    // Three shapes rather than one that tests both per request: a process either has a bundle and a
    // public directory for its whole life or it does not, and this is the outermost function on every
    // request the app takes. Both are IN FRONT of the compressor and deliberately — a bundle was
    // compressed once at build time and its sidecar is already chosen by the same header, so running
    // it through a second compressor would spend cpu per request to make brotli bytes bigger.
    const files: { serve(request: Request): Response | undefined }[] = []
    if (assets !== null) files.push(assets)
    if (publics !== null) files.push(publics)
    const first = files[0]
    const second = files[1]
    const answer: Answer =
        first === undefined
            ? (request: Request, server: Parameters<typeof handled>[1]): ReturnType<typeof handled> =>
                  compressing(request, handled(request, server))
            : second === undefined
              ? (request: Request, server: Parameters<typeof handled>[1]): ReturnType<typeof handled> =>
                    first.serve(request) ?? compressing(request, handled(request, server))
              : (request: Request, server: Parameters<typeof handled>[1]): ReturnType<typeof handled> =>
                    first.serve(request) ??
                    second.serve(request) ??
                    compressing(request, handled(request, server))

    return { entry, paged, assets, publics, answer }
}

/**
 * The assembled app on a socket — or the exit code of a refusal already PRINTED.
 *
 * `null` is neither: an `onStart` that returned without calling `start()` is the app deciding this
 * process should not serve, which `boot` says so on `abide:lifecycle` and is an outcome rather than a
 * failure.
 *
 * Here rather than in `abide start`, because there are three callers now — `start`, and the console's
 * `serve` in both of its shapes — and what they share is every line of it: the two `Bun.serve`
 * options that are spelled rather than inferred, and what a taken port means. `abide dev` is not one
 * of them and cannot be: it HOPS, which is a loop around this rather than an argument to it.
 */
export async function bind(
    assembled: Assembly,
    port: number,
    label: string,
): Promise<ReturnType<typeof Bun.serve> | null | number> {
    try {
        return await boot(() =>
            Bun.serve({
                port,
                // Off, deliberately. Bun's development mode answers an uncaught throw with a page
                // describing the stack, which is a debugging tool and an information leak in the same
                // response. `onError` is where an app decides what a failure looks like here.
                development: false,
                // Spelled, because Bun infers it from `development` and infers the wrong one here:
                // `development: false` turns SO_REUSEPORT ON, so a second production process binds
                // the same port instead of failing, both listen, and the kernel hands the requests to
                // whichever bound first. That is precisely the case the refusal below exists to make
                // loud — a deploy answering from the process it was meant to replace — and it is
                // silent, because both processes print `listening` on the port they agree on.
                reusePort: false,
                fetch: assembled.answer,
                websocket,
            }),
        )
    } catch (failure) {
        // A port in use is the one failure with something to say beyond the message, and it is HARD
        // here on purpose: `abide dev` hops to the next free port because a developer wants the thing
        // to come up, and a deploy that quietly listened somewhere else is a health check passing
        // against the process it was meant to replace. The port asked for is the port or it is
        // nothing.
        if ((failure as { code?: string }).code === 'EADDRINUSE') {
            console.error(`${label}: port ${port} is already in use`)
            console.error('       stop what is on it, or name another with `--port <n>`')
        } else {
            console.error(`${label}: ${messageOf(failure)}`)
        }
        return CLI_EXIT_CODES.failed
    }
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
async function pageLayer(
    root: string,
    document: AppShell,
    head: string | undefined,
    scanned: PageFiles[] | undefined,
    imaged: ImagedPages | null | undefined,
): Promise<Paged | null> {
    const directory = `${root}/${PAGES}`
    if (imaged === undefined) {
        try {
            if (!(await Bun.file(directory).stat()).isDirectory()) return null
        } catch {
            return null
        }
    } else if (imaged === null) return null

    // A PAGE is the one render that always hydrates, so the lane goes in here rather than in the
    // document itself — what was published is what a route asking for `{ shell: true }` gets, and
    // that render adds the lane only if it asked to hydrate.
    //
    // `head` is BY DEFINITION the text before `</head>`, so appending lands exactly where a second
    // scan for `</head>` would have. Copied rather than appended to, because the parts this is built
    // from are the ones every other render in the process is now holding.
    const shell: AppShell = {
        parts: { ...document.parts, head: document.parts.head + document.lane + (head ?? '') },
        lane: document.lane,
        own: document.own,
    }
    if (imaged !== undefined) return { table: pagesFrom(directory, imaged.files, imaged.loaders), shell }
    return { table: scanned === undefined ? await pages(directory) : pagesFrom(directory, scanned), shell }
}

/**
 * The app's own route with the pages behind it, or whichever of the two exists.
 *
 * The app goes FIRST and `undefined` is what hands over, which is the same word `handle` reads as a
 * 404 — so an app that wants a path the pages directory also claims simply answers it, and one that
 * wants none writes no default export at all. Composed once at boot: an app with no route of its own
 * gets the renderer itself, rather than a wrapper testing for it per request.
 */
function composed(declared: Route | null, paged: Paged | null, manifest: ClientManifest | null): Route {
    // Nothing of its own and nothing to render: every path is then `handle`'s 404, which is an app
    // made entirely of endpoints.
    if (paged === null) return declared ?? ((): undefined => undefined)
    routes(paged.table)
    const rendered = renderer(paged.shell.parts, shellsPerRoute(paged, manifest))
    const ordinary: Route =
        declared === null
            ? rendered
            : (request: Request, server: Parameters<Route>[1]): ReturnType<Route> => {
                  const answered = declared(request, server)
                  if (answered === undefined) return rendered(request)
                  if (isThenable(answered)) return answered.then((settled) => settled ?? rendered(request))
                  return answered
              }
    return failingPage(ordinary, paged.shell.parts)
}

/**
 * The app's route with its `error.abide` behind it: nothing answered is a 404 page, and a throw is a
 * page at whatever status the throw carries.
 *
 * HERE rather than in `lifecycle.ts` beside the JSON refusals it stands in front of, and the reason
 * is the shell: an error page is a PAGE, so it is owed the document, the layouts above it and the
 * hydration lane, and this is the innermost layer that holds one. `lifecycle.ts` keeps the JSON — an
 * app that wrote no `error.abide` is unchanged, and so is every `/__abide/**` endpoint, which is not
 * a page and must not answer one.
 *
 * BEFORE THE FIRST BYTE is the whole of what this can cover, and the boundary is exact rather than a
 * limitation to apologise for: a document is a stream, so a page that throws once its shell is on the
 * wire cannot be replaced by another page. That failure is `{#try}`'s, which can still take back a
 * region it has not flushed. This one takes the cases where nothing has been written at all — no
 * route matched, a middleware rung threw, a page's own module failed to load.
 */
function failingPage(ordinary: Route, shell: Shell): Route {
    return (request: Request, server: Parameters<Route>[1]): ReturnType<Route> => {
        let answered: ReturnType<Route>
        try {
            answered = ordinary(request, server)
        } catch (failure) {
            return errorPage(request, shell, failure)
        }
        if (answered === undefined) return errorPage(request, shell, null)
        if (!isThenable(answered)) return answered
        return answered.then(
            (settled) => settled ?? errorPage(request, shell, null),
            (failure: unknown) => errorPage(request, shell, failure),
        )
    }
}

/**
 * The failure as a rendered document, or `undefined`/a rethrow for an app with no `error.abide` above
 * this path — which is what leaves `lifecycle.ts`'s JSON exactly as it was.
 *
 * `null` for the failure is the 404: nothing threw, nothing answered. Anything else keeps the status
 * it declared, so an `error(403)` reaches the page as a 403 rather than being flattened to a fault.
 */
function errorPage(
    request: Request,
    shell: Shell,
    failure: unknown,
): Promise<Response | undefined> | undefined {
    const url = new URL(request.url)
    // An error page is a PAGE, and a page is a read — the same rule `renderer` opens with. A POST that
    // matched no route is not a reader who took a wrong link, and answering it with a document would
    // hand markup to a caller that asked for none. Those keep the JSON refusal, which is what every
    // non-browser caller already decodes, and so does a path with no `error.abide` above it.
    const reading = request.method === 'GET' || request.method === 'HEAD'
    const held = reading ? errorFor(url.pathname) : null
    if (held === null) {
        if (failure === null) return undefined
        throw failure
    }
    const status = failure === null ? 404 : statusOf(failure)
    const said: Failure = {
        status,
        name: failure === null ? 'AbideRouteError' : nameOf(failure),
        message: failure === null ? `nothing is served at ${url.pathname}` : messageOf(failure),
    }
    // Awaited rather than kicked, for the reason the page renderer awaits its own: a module that has
    // not arrived is not a tree, and an error page rendering as empty is the one page where there is
    // nothing else on screen to say what happened.
    const loading = errorReady(held)
    // A NAVIGATION asked, so it gets what every navigation gets: the outlet on its own, marked, and
    // no second copy of a head the reader is already looking at. Without this the client saw a
    // document it could not place, handed the URL to the browser and reloaded the whole page to show
    // a 404 it was already holding the markup for.
    //
    // Depth 0 always, and deliberately: `sharedLayoutDepth` compares two ROUTE names and an error
    // page has none, so there is no honest number to send. The client then fills the outlet's own
    // range, which is the one place a page with no route can go.
    const navigating = request.headers.get(NAVIGATION_HEADER) !== null
    const answer = (): Response =>
        navigating
            ? page(fragmentToStream(() => errorOutlet(held, said), HYDRATABLE), {
                  status,
                  headers: {
                      ...NAVIGATION_HEADERS,
                      [NAVIGATION_FAILURE_HEADER]: failureHeader(said),
                  },
              })
            : page(documentToStream(shell, () => errorOutlet(held, said), HYDRATABLE), { status })
    return loading === null ? Promise.resolve(answer()) : loading.then(answer)
}

function nameOf(failure: unknown): string {
    if (failure instanceof Error) return failure.name
    return 'Error'
}

/**
 * The document each route is served in, with that route's own chunks named in its head.
 *
 * Per ROUTE and built once, because a route table is fixed at boot and so is the set of files each
 * route reaches: computing this per request would be a graph walk and a string concat on the hottest
 * path this binary has, to produce the same head every time. What a request pays is a map lookup.
 *
 * The preload is what stops splitting costing a second serial round trip. A page reached through
 * `() => import(…)` is deliberately absent from the first load — that is the whole point of a loader
 * — but the browser cannot discover it until the entry has downloaded, parsed and RUN far enough to
 * reach the call. Naming it in the head makes the two fetches overlap instead, which is the one
 * change here that moves time-to-interactive rather than time-to-content.
 *
 * `modulepreload` and not `preload`: the two differ by more than a word — this one tells the browser
 * the bytes are a MODULE, so it parses and instantiates them and pulls in their static imports rather
 * than parking bytes in a cache for a second discovery to hit.
 */
function shellsPerRoute(paged: Paged, manifest: ClientManifest | null): Map<string, Shell> {
    const perRoute = new Map<string, Shell>()
    const graph = manifest?.graph
    if (graph === undefined) return perRoute

    for (const entry of paged.table) {
        const source = entry.source
        if (source === undefined) continue
        // The table's paths are relative to the pages DIRECTORY and the graph is keyed from the
        // project root, which is the seam where the two halves meet: `pages()` read a directory and
        // cannot know where it sits, and the bundler recorded what it was pointed at.
        const named: string[] = []
        for (const file of source.layouts) reachable(graph, `${PAGES}/${file}`, named)
        reachable(graph, `${PAGES}/${source.page}`, named)
        if (named.length === 0) continue

        let links = ''
        const at = mounted(CLIENT_ROUTE)
        for (const name of named) links += `<link rel="modulepreload" href="${at}${name}">`
        // A shallow copy per ROUTE, not per request: `open` and `close` are the same strings every
        // route is served with, and only the head differs.
        perRoute.set(entry.path, { ...paged.shell.parts, head: paged.shell.parts.head + links })
    }
    return perRoute
}

/**
 * The chunk holding `file`, and every chunk it STATICALLY imports, appended to `named` without
 * repeats.
 *
 * Transitive because a chunk whose own imports are not named is a chunk that downloads and then
 * blocks on discovering them — one round trip traded for another. Static only: a `dynamic-import`
 * edge is a chunk the browser fetches if it ever gets there, and following those would pull the whole
 * route table into the first load, undoing the splitting this exists to make cheap.
 *
 * The `named` array doubles as the seen-set. A route reaches a handful of chunks and its layouts
 * share most of them, so a linear scan over what is already there beats a `Set` allocated per route.
 */
function reachable(graph: ClientGraph, file: string, named: string[]): void {
    const held = graph.modules[file]
    // Already named is already CLOSED over: every entry the loop below appends is walked by that same
    // loop before the call returns, so nothing reachable from `held` can be missing. Returning here is
    // what keeps the COMMON case cheap — a page and its layouts share most of their chunks, and
    // re-entering the walk would re-enumerate a subtree already entirely in `named`.
    if (held === undefined || named.indexOf(held) !== -1) return
    let at = named.length
    named.push(held)
    // Index-based and re-reading `length`: entries are appended as the walk runs, which is what makes
    // this a breadth-first close over the graph rather than a recursion carrying its own stack.
    for (; at < named.length; at++) {
        const imports = graph.imports[named[at] as string]
        if (imports === undefined) continue
        for (const name of imports) if (named.indexOf(name) === -1) named.push(name)
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
function renderer(
    shell: Shell,
    perRoute: Map<string, Shell>,
): (request: Request) => Promise<Response | undefined> {
    return async (request: Request): Promise<Response | undefined> => {
        // A page is a READ. Anything else against the same path is the app's to answer, and a 404
        // when it did not.
        if (request.method !== 'GET' && request.method !== 'HEAD') return undefined
        // `kind`, which is the router's own word for "nothing matched" — the empty name it is derived
        // from is that module's encoding rather than a fact this one may read.
        const asked = routeAsked()
        if (asked.kind === 'missing') return undefined

        // The page's module, before the walk that renders it: a render is a snapshot, and a module
        // that has not arrived is not a tree. `readying` rather than `ready`, because after the first
        // view of a route there is nothing left to load — and an `await` on the settled promise
        // `ready()` hands back would be a microtask tick charged to every page this process serves.
        const loading = readying()
        if (loading !== null) await loading

        // A client-side navigation asked for this page, and it is already looking at the document —
        // so what it needs is the outlet and not a second head, a second shell or a second copy of
        // every `<script>` it has already run. The same walk with the same options either way: the
        // markup a navigation adopts has to be the markup it would have hydrated.
        //
        // This branch is the ONLY thing a navigation changes on the server. It is reached through the
        // app's middleware exactly as a full page load is, because it IS a full page load as far as
        // everything above here is concerned — same path, same scope, same onion.
        if (request.headers.get(NAVIGATION_HEADER) !== null) {
            // How much of this page's layout stack the caller is already showing. The client says
            // where it is; the SERVER decides what that is worth, because it is the side holding both
            // route entries — a client computing the same number off its own table would be one rule
            // implemented twice. Absent header means a caller that cannot place a fragment, so 0.
            const from = request.headers.get(NAVIGATION_FROM_HEADER)
            const depth = from === null ? 0 : sharedLayoutDepth(from)
            return page(
                fragmentToStream(() => outletFrom(depth), HYDRATABLE),
                {
                    // The depth is written only when it is not 0 — an answer that left nothing off has
                    // nothing to say about depth, and the shared record is then handed over untouched.
                    headers:
                        depth === 0
                            ? NAVIGATION_HEADERS
                            : { ...NAVIGATION_HEADERS, [NAVIGATION_DEPTH_HEADER]: String(depth) },
                },
            )
        }

        // This route's own document — the shell with its chunks named in the head. One map lookup,
        // and the shared shell for a route the build knew nothing about.
        return page(documentToStream(perRoute.get(asked.name) ?? shell, outlet, HYDRATABLE))
    }
}

/**
 * What marks a navigation's answer, and what stops a cache from serving it to a page load.
 *
 * `Vary` is not optional here: two callers ask for ONE url and get a document or a fragment depending
 * on a request header, and a shared cache that missed that would serve a fragment to a browser
 * opening the page cold — a blank window with the head missing. The mark itself is what the client
 * tells the two apart by, because an app's own route may answer the same path with anything.
 */
const NAVIGATION_HEADERS: Record<string, string> = {
    [NAVIGATION_HEADER]: '1',
    // BOTH, because two different request headers now change the body: the mark says fragment rather
    // than document, and the from-route says how much of the fragment was left off. A cache keyed on
    // only the first would serve a depth-2 answer to a caller standing somewhere else, which is a page
    // with its outer layouts missing.
    vary: `${NAVIGATION_HEADER}, ${NAVIGATION_FROM_HEADER}`,
}

// --- compressing what the app answered ---------------------------------------

/** The one encoding offered. See `compressed` for why the asset route's brotli is not here. */
const RESPONSE_ENCODINGS = ['gzip']

/**
 * The answer, compressed when it is markup and the caller takes it.
 *
 * Here rather than in `page()` for two reasons that point the same way: `#server/responses.ts` is
 * bundled for the BROWSER — the dogfood app's server suite renders in a card — so it cannot reach a
 * compressor at all, and a rule that only covered the documents abide itself builds would leave an
 * app's own `text/html` route uncompressed for no reason a reader could name.
 *
 * `undefined` is `handle`'s 404 and passes straight through; a settled response is the common shape
 * and is not awaited, because a page render that did not have to wait returns one.
 */
function compressing(
    request: Request,
    answered: Response | Promise<Response | undefined> | undefined,
): Response | Promise<Response | undefined> | undefined {
    if (answered === undefined) return undefined
    if (isThenable(answered)) {
        return answered.then((settled) => (settled === undefined ? undefined : compressed(request, settled)))
    }
    return compressed(request, answered)
}

/**
 * The size at which an answer that is not markup is worth a compressor.
 *
 * The rule below used to be markup-only, on the premise that "everything else an endpoint answers is
 * small enough that a compressor per request is the more expensive half". That is right for the
 * answers it was written about and WRONG for the one that motivated this: an rpc returning a list a
 * page then filters in the browser served 637,179 bytes where gzip is 80,464 — 7.9x, on a payload
 * whose whole purpose is to cross the wire once and be worked on client-side.
 *
 * So the premise is kept where it holds and bounded by a number. Below this an answer saves a couple
 * of KB at best and still pays the compressor; above it the saving grows with the body.
 */
const COMPRESSIBLE_BYTES = 4096

/**
 * Is this `content-type` that media type, as against one whose NAME MERELY STARTS WITH IT?
 *
 * `application/jsonl` starts with `application/json`, so a `startsWith` admitted the very framing the
 * allow-list below names as excluded and buffered it whole: five rows produced 150ms apart arrived
 * together at 763ms, under a `content-length` on a body that is supposed to have none. Nothing was
 * red — a buffered stream is the same bytes, and only the arrival time says otherwise.
 *
 * Not `===`, because a type may carry parameters (`application/json; charset=utf-8`) and that is
 * still the same type. `;` and the space some writers put before one are the two ends that count.
 */
function isMedia(type: string, name: string): boolean {
    if (!type.startsWith(name)) return false
    if (type.length === name.length) return true
    const next = type[name.length]
    return next === ';' || next === ' '
}

/**
 * One response, compressed or handed back as it is.
 *
 * Markup at any size, streamed through a sync-flushed gzip so the parser still gets the head early.
 * `application/json` when its bytes exceed `COMPRESSIBLE_BYTES`, buffered — it is already a string in
 * memory, and the compressor is about to read all of it anyway. The asset route is in front of this
 * because its bytes were compressed once at build time.
 *
 * `vary` goes on even when this hands the bytes back untouched, for the reason the asset route says
 * it: the header describes what the ANSWER depends on, and a shared cache that stored the identity
 * form without it would go on serving those bytes to a caller that asked for gzip. That is what the
 * rebuild on the identity path buys — one `Response` and one header copy per page, against a cache
 * that hands compressed bytes to a caller that cannot read them.
 */
function compressed(request: Request, response: Response): Response | Promise<Response> {
    const type = response.headers.get('content-type')
    if (type === null) return response
    // Nothing to compress, and nothing a `Vary` would protect: a HEAD, a 204 and a 304 all carry no
    // body, and rebuilding one would be a `Response` per request for no bytes.
    if (response.body === null) return response
    // An app that compressed its own answer means it.
    if (response.headers.get('content-encoding') !== null) return response
    // An ALLOW-LIST on purpose: `content-length` cannot decide this, because a handler returns a
    // `Response` built from a string and the runtime writes the length at the socket, so the header is
    // absent on the object this sees and every buffered answer reads as a stream. The type is what
    // distinguishes the two — and naming the one that MAY be buffered is safer than naming the framed
    // ones to exclude, because a framing added later then defaults to being left alone. `NDJSON_TYPE`,
    // `JSONL_TYPE` and `text/event-stream` are absent for that reason: each is framed so a browser can
    // read it as it arrives, and buffering one to measure it would undo the framing.
    const markup = isMedia(type, 'text/html')
    if (!markup && !isMedia(type, JSON_TYPE)) return response

    const headers = new Headers(response.headers)
    // Appended rather than set: the navigation branch above already varies on its own header, and a
    // response that varies on two things has to say both or a cache picks one.
    headers.append('vary', 'accept-encoding')
    const init: ResponseInit = { status: response.status, statusText: response.statusText, headers }
    // Tested BEFORE either arm reads a body: this asks about the REQUEST, so it is settled whatever the
    // size turns out to be, and a client that cannot read gzip would otherwise pay a full buffer and
    // copy of every JSON answer to measure something it was never going to act on.
    if (acceptedEncoding(request.headers.get('accept-encoding'), RESPONSE_ENCODINGS) < 0) {
        return new Response(response.body, init)
    }
    if (!markup) return buffered(response, headers, init)

    // SYNC-FLUSHED, which is the whole reason this is `node:zlib` rather than the web standard.
    // `CompressionStream('gzip')` holds its input until the source closes: a document whose head was
    // written immediately emitted 10 bytes — the gzip header — and nothing else until the last
    // deferred subtree settled. The out-of-order protocol in `MARKERS.ts` exists precisely so a
    // browser's parser gets the head early, and buffering the body would undo it. `Z_SYNC_FLUSH` ends
    // a block at every write, so the same document came out at 1 ms and 122 ms instead of only at the
    // end, for about five bytes per flush.
    const gzip = createGzip({ flush: constants.Z_SYNC_FLUSH })
    const bridged = Duplex.toWeb(gzip)
    // Not awaited: `pipeTo` settles when the whole body has been written, and what the runtime is
    // handed is the READ end, which it is already consuming. A rejection here is the caller having
    // gone away — the pipe reports that by erroring the readable the runtime holds, so there is
    // nothing for this to do with it but not become an unhandled rejection.
    void response.body.pipeTo(bridged.writable).catch(() => {})
    headers.set('content-encoding', 'gzip')
    // The length described the identity bytes and describes nothing now. The runtime drops it for a
    // chunked body as well, so this is belt-and-braces — kept where the matching `set` on the buffered
    // arm was dropped, because the two fail in opposite directions: a length the runtime overwrites is
    // waste, and a length that outlived its bytes is a client waiting for bytes never coming.
    headers.delete('content-length')
    return new Response(bridged.readable as unknown as ReadableStream<Uint8Array>, init)
}

/**
 * A buffered answer, gzipped WHOLE when it is big enough to be worth it.
 *
 * Whole rather than streamed, because the size is the decision and the size is not knowable until the
 * bytes are in hand — and they already are, since this shape is a `Response` built from a string. One
 * `Bun.gzipSync` beats a stream bridge here for the same reason the document needs the opposite: there
 * is no parser waiting on an early first byte, so there is nothing to flush for.
 *
 * The headers arrive already varied, from the one place `compressed` builds them — its only caller,
 * and past the point where a caller that cannot read gzip has been answered. The `vary` is on both
 * arms and on the under-threshold answer too: a shared cache that stored the identity form of an
 * answer under this threshold, unmarked, would hand those bytes to a caller that asked for gzip —
 * which is fine — but the same URL with different args can land on either side of the threshold, so
 * the header has to describe the answer rather than the rule.
 */
async function buffered(response: Response, headers: Headers, init: ResponseInit): Promise<Response> {
    // The IDENTITY size is measured because it is the DECISION — a branch, not a header — and it is
    // the whole reason this arm reads the body at all.
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength <= COMPRESSIBLE_BYTES) return new Response(bytes, init)
    headers.set('content-encoding', 'gzip')
    // The COMPRESSED size is not, and stating it here bought nothing: the runtime writes
    // `content-length` from the bytes it actually sends, overriding whatever these headers carry — a
    // stale one included. So the progress bar a caller gets is the runtime's doing, and this was a
    // number formatted into a string per compressed response for a header that was overwritten.
    return new Response(Bun.gzipSync(bytes), init)
}

// --- what an app's module says about itself ----------------------------------

/**
 * The one export this binary reads. `unknown` because a module is whatever it was written as, and
 * `routeOf` below is what turns that into a route.
 *
 * ONE, because a hook is a REGISTRATION and a registration is a call the module makes for itself —
 * `onStart(…)` at module scope, checked against `StartHook` by the app's own typecheck. There was a
 * second lane here that read `onStart` / `onStop` / `onError` / `onConfig` / `onHealth` /
 * `onIdentity` / `middleware` off this namespace and handed each to the function of the same name,
 * and every hook it carried was typed against nothing on the way through — which is why it had to
 * check shapes at runtime and answer with a refusal an app could only find by booting. A route has
 * no call form, so `default` stays; nothing else needs one.
 */
interface AppModule {
    default?: unknown
}

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

// --- the arguments and the report --------------------------------------------

/**
 * The port a command line asked for: a number, `null` for nothing asked, a message for a mistake.
 *
 * `0` is a legal answer and means "whatever is free" — the kernel's own spelling, and what a test or
 * a container with a port already mapped for it wants. Everything else is checked as a PORT rather
 * than as a number, because `--port 70000` is a typo that would otherwise be found by a bind failing.
 *
 * Behind `portAsked`, which is what both commands call: they must not disagree about what a port IS.
 * They differ about what to do when one is TAKEN, which is a decision each makes afterwards. The
 * console's `serve` action reads it directly, because its refusal is not `abide serve`'s.
 */
export function portFrom(argv: string[]): number | null | string {
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
 * The `--port` a command line asked for, APPLIED — or `false` for a refusal already printed.
 *
 * Written once for the same reason the assembly messages are: `abide start` and `abide dev` had the
 * parse, the two message lines and the env spelling each, and the usage line each command printed was
 * a second copy of the `args` its row in `COMMANDS` already carries. Two commands with one flag
 * between them is one of them drifting.
 *
 * Spelled as the VARIABLE, before anything resolves the document. `config()` is the one answer to what
 * this process is running on, so a flag that kept its own number beside it would be a second one — and
 * the app's own `PORT` default would go on being reported by `config().PORT` while the socket sat
 * somewhere else. Declared here, the flag beats an app's `onConfig` default exactly as an operator's
 * variable does, which is the same rule stated once.
 *
 * The REFUSAL is printed here and the exit code is not, because that is what the two commands differ
 * about: `abide start` returns one and `abide dev` posts it to a main thread. It goes through `refuse`
 * so the usage line is the `args` the help screen prints, rather than a second spelling of it beside
 * the code that reads the flag.
 */
export function portAsked(argv: string[], name: string): boolean {
    const asked = portFrom(argv)
    if (typeof asked === 'string') {
        refuse(name, asked)
        return false
    }
    if (asked !== null) process.env.PORT = String(asked)
    return true
}

/**
 * Two lines: where it is listening, and what it is serving.
 *
 * The URL is FIRST and on its own, because it is the one thing anybody reads — and because something
 * watching this process (a test, a supervisor, a dev script) should not have to parse a banner to
 * learn the address. The endpoint counts are on the second line for the question they answer: a
 * transport module that was never imported registers nothing, and `0 rpc` is what that looks like.
 */
export function report(url: string, assembly: Assembly, note?: string): void {
    const on = colored()
    // The address an operator should OPEN, which under a mount is not the socket's own: the server
    // binds an origin and the app is served under a path of it, so printing the origin sends a reader
    // to a 404 in their own app. `new URL` rather than concatenation — `url` ends in `/`.
    const at = new URL(mounted('/'), url).href
    console.log(`listening ${paint(at, BOLD, on)}`)

    // Named only when there is one. An app with no module of its own has nothing to say here, and a
    // line reading `app.ts` for a file that is not there is the one mistake this line exists to catch.
    const parts: string[] = []
    if (assembly.entry !== null) parts.push(basename(assembly.entry))
    const paged = assembly.paged
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
    const assets = assembly.assets
    parts.push(assets === null ? 'no client bundle' : `${plural(assets.count, 'file')} at ${CLIENT_ROUTE}`)
    // Only when there ARE some. An app with no public directory is the common case, and a line saying
    // so every boot is noise about a convention it has not opted into.
    const publics = assembly.publics
    if (publics !== null) parts.push(`${plural(publics.count, 'file')} from ${PUBLIC_DIR}`)
    if (note !== undefined) parts.push(note)
    console.log(paint(`  ${parts.join(' · ')}`, DIM, on))
}
