// EVERY EXAMPLE, RENDERED AND MOUNTED, the way its card does it: the component the card renders,
// painted on the server and adopted on the client. `abide build` asks whether each one COMPILES,
// which is a weak bar: a module that compiles can still walk to a node that is not there or throw
// on its first read. This one runs them.
//
// 68 components written before the compiler existed, using surface the rulebook decided. What they
// exercise is not what a fixture written beside the implementation exercises, which is the whole
// reason to run them rather than more of my own pages.

import { expect, test } from 'bun:test'
import {
    type AbideFile,
    type Compilation,
    componentGraph,
    emitClient,
    emitComponent,
    parseAbide,
    serveCompilation,
    TypeSession,
} from '@abide/abide/compiler'
import { render } from '@abide/abide/server'
import { privateAddress } from '../../abide/src/compiler/handlersUnder.ts'
import { PRIVATE_EXPORT } from '../../abide/src/server/PRIVATE_EXPORT.ts'
import { Refusals } from '../../abide/src/compiler/Refusals.ts'
import { resolverIn } from '../../abide/src/compiler/resolverIn.ts'
import { appFiles } from '../../abide/src/server/appTree.ts'
import { placement, routeOf } from '../../abide/src/server/placement.ts'
import { inScope } from '../../abide/src/server/requestScope.ts'
import { browserCookies, COOKIES } from '../../abide/src/shared/cookies.ts'
import { RPC_SERVER } from '../../abide/src/shared/RPC_SERVER.ts'
import {
    removeTemporaryModules,
    temporaryModule,
} from '../../abide/tests/temporaryModule.ts'
import { allCards } from './docsPages.ts'

const APP = new URL('../', import.meta.url).pathname
// EVERY CHAPTER APP'S `src`, from the docs app's root: every card renders a component from one (40.32).
const CHAPTER_APPS: string[] = []
for (const manifest of new Bun.Glob('examples/*/package.json').scanSync({
    cwd: APP,
}))
    CHAPTER_APPS.push(`${manifest.slice(0, -'package.json'.length)}src`)
const TSCONFIG = `${APP}tsconfig.json`

// A file that is an app's page rather than a component a card renders.
function isRoute(path: string): boolean {
    return /(^|\/)(index|layout|error|launcher)\.abide$/.test(path)
}

// The handlers a `<script server>` declares, by the call that declares them — what the build's
// handler table keeps of the bindings the server module hands out (16.70).
const HANDLER = /^const (\w+) = (?:GET|POST|PUT|PATCH|DELETE)\(/gm

// EVERY CHAPTER APP, COMPILED WHOLE: its `package.json`, every `.ts` and `.abide` under its `src`,
// and every component compiled to the pair it becomes, served at its own path as a build serves it
// (`abideModules`). The pages are left out: what is under test is what each card invokes.
async function appTree(session: TypeSession): Promise<{
    tree: Record<string, string>
    compilation: Compilation
}> {
    const tree: Record<string, string> = {}
    const files: { path: string; file: AbideFile; belowRoot: string }[] = []
    for (const root of CHAPTER_APPS) {
        const manifest = `${root.slice(0, -'src'.length)}package.json`
        tree[manifest] = await Bun.file(`${APP}${manifest}`).text()
        for (const path of new Bun.Glob('**/*.ts').scanSync({
            cwd: `${APP}${root}`,
        }))
            tree[`${root}/${path}`] = await Bun.file(
                `${APP}${root}/${path}`,
            ).text()
        for (const path of new Bun.Glob('**/*.abide').scanSync({
            cwd: `${APP}${root}`,
        })) {
            if (isRoute(path)) continue
            // The source rides along: a handler that imports a component resolves the `.abide`.
            const text = await Bun.file(`${APP}${root}/${path}`).text()
            tree[`${root}/${path}`] = text
            files.push({
                path: `${APP}${root}/${path}`,
                file: parseAbide(text),
                belowRoot: path,
            })
        }
    }
    // 32.17 — which components another one invokes decides whether a module carries its own
    // markup for a row built in the browser. THE APP'S RESOLVER, not `Bun.resolveSync`: that asks
    // every plugin again, and a compilation an earlier file in this process served answers it from
    // the directory read as a file — `InvoiceDocument.abide` is then looked for one level up.
    const graph = componentGraph(files, resolverIn())
    const { answers } = await session.readsFor(files)
    const compilation: Compilation = {
        files: {},
        handlers: {},
        tables: {},
    }
    for (let at = 0; at < files.length; at += 1) {
        const {
            path: absolute,
            file,
            belowRoot,
        } = files[at] as (typeof files)[number]
        const names = answers[at]
        const stem = absolute.slice(APP.length, -'.abide'.length)
        // 37.1 — a server block files its hooks at its route, or under a `lib` at its directory's.
        const server = emitComponent(
            file,
            names,
            false,
            placement(belowRoot).scope,
        )
        // A CHILD WITH NOTHING TO HYDRATE STILL NEEDS A MODULE, because its caller imports one.
        // `emitClient` answers '' for a static file — that is what makes a static page ship no
        // runtime — so the no-op stands in wherever a caller has to have something to call.
        // IN ONE PROCESS a handler is its own server module's: the browser's module of a file
        // declaring some binds them from it, where a build would write the wire in their place.
        const client =
            emitClient(
                file,
                names,
                graph.invoked.has(absolute) ? 'invoked' : 'none',
            ) || 'export default () => {}'
        const name = stem.slice(stem.lastIndexOf('/') + 1)
        // Bound by name, as a build's stand-ins are: the file's own `<script>` calls them, and the
        // server's module hands each out as `__handler_<name>` (16.70).
        const handlers: string[] = []
        for (const [, declared] of file.servers.join('\n').matchAll(HANDLER))
            handlers.push(declared as string)
        // Through a module of the app's own, which reaches the server's module where the
        // browser's, importing it directly, would reach its own.
        if (handlers.length > 0)
            tree[`${stem}.handlers.ts`] =
                `export { ${handlers.map((one) => `${PRIVATE_EXPORT}${one} as ${one}`).join(', ')} } from './${name}.abide?component'\n`
        compilation.files[`${stem}.abide`] = {
            server,
            client:
                handlers.length > 0
                    ? `${client}\nimport { ${handlers.join(', ')} } from './${name}.handlers.ts'\n`
                    : client,
            sheet: undefined,
            serverMappings: undefined,
            clientMappings: undefined,
        }
    }
    return { tree, compilation }
}

test('every example renders on the server and mounts on the client', async () => {
    const session = await TypeSession.open(TSCONFIG)
    const broken: string[] = []
    let painting = ''

    // A MOUNT'S FAILURE CAN ARRIVE AFTER THE MOUNT. The effects a mount schedules run in a later
    // turn, so a component that throws there throws outside the `try` below and would be counted as
    // RUNNING. Nothing here can tear a mount down — the emitted `mount` hands back no disposer —
    // so the escape is caught and counted instead, and the drain after each mount is what puts it
    // in the right example's turn.
    //
    // ON THE WINDOW, NOT ON THE PROCESS. happy-dom wraps every queued task in its own try/catch
    // and turns a throw into an `error` event it also prints, so `process.on('uncaughtException')`
    // never sees one.
    const escaped = (event: Event): void => {
        const thrown =
            (event as ErrorEvent).error ??
            (event as PromiseRejectionEvent).reason
        broken.push(`${painting}: ${String(thrown).split('\n')[0] ?? ''}`)
    }
    addEventListener('error', escaped)
    addEventListener('unhandledrejection', escaped)

    // THE ROUND TRIP — the server paints, `innerHTML` parses, and the client module adopts what it
    // finds — needs its own ASSERTION: a mismatch warns and rebuilds the block (41.10), it does not
    // throw, so a component whose every binding missed its node still mounts. 41.9 is what this
    // holds: where the client looks for a node is decided by the walk that wrote the server's
    // markup, and this is the check that the decision holds against real components.
    const mismatched: string[] = []
    const warned = console.warn
    console.warn = (...args: unknown[]): void => {
        if (args[0] === 'abide:hydrate')
            mismatched.push(`${painting}: ${String(args[1] ?? '')}`)
        warned(...args)
    }

    const serverCookies = COOKIES.current
    const fetched = globalThis.fetch
    // NO APP ANSWERS A `raw` CALL IN PROCESS, whatever ran first: an app booted earlier in this
    // process is the one a call outside every request falls to (16.42), stopped or not, and the
    // `null` the stub below would have answered is that app's refusal instead. THE REVERT: drop the
    // pin; after `socketScope.test.ts` in one process `json-null` reports a `SyntaxError`.
    const serverRaw = RPC_SERVER.raw
    RPC_SERVER.raw = null
    try {
        const { tree, compilation } = await appTree(session)
        const dir = temporaryModule(tree)
        serveCompilation(dir, compilation)
        // 16.9 — A HANDLER HAS ITS ADDRESS FROM BOOT, so a card reading `rpc.url` or `rpc.raw` has
        // one before anything is called; the copy is given the address `mountHandlers` would give:
        // a private handler's below `/__abide/handlers` (16.70), a handler file's at its path.
        for (const root of CHAPTER_APPS) {
            for (const path of new Bun.Glob('**/*.abide').scanSync({
                cwd: `${APP}${root}`,
            })) {
                if (isRoute(path)) continue
                const module = await import(`${dir}/${root}/${path}?component`)
                for (const [bound, handler] of Object.entries(module))
                    if (
                        bound.startsWith(PRIVATE_EXPORT) &&
                        typeof handler === 'function' &&
                        'method' in handler
                    )
                        (handler as { address?: string }).address =
                            privateAddress(
                                path,
                                bound.slice(PRIVATE_EXPORT.length),
                            )
            }
            for (const belowRoot of appFiles(
                `${APP}${root}`,
                new Refusals(APP, true),
            ).handlers) {
                const { default: handler } = await import(
                    `${dir}/${root}/${belowRoot}`
                )
                if (typeof handler === 'function' && 'method' in handler)
                    (handler as { address?: string }).address =
                        routeOf(belowRoot)
            }
        }
        // A `raw` CALL GOES OVER THE WIRE, and there is no server here: it is answered `null`, which
        // is what is under test — the card paints and adopts — and not what the handler says.
        globalThis.fetch = Object.assign(
            async () =>
                new Response('null', {
                    headers: { 'content-type': 'application/json' },
                }),
            { preconnect: () => {} },
        ) as typeof fetch
        for (const card of await allCards()) {
            const example = card.id
            painting = example
            const stem = card.component.slice(0, -'.abide'.length)
            try {
                const { default: Component } = await import(
                    `${dir}/${stem}.abide?component`
                )
                let html = ''
                // IN A REQUEST, as a page is always rendered: `principal` reads the request's
                // cookie and throws outside one (22.1).
                COOKIES.current = serverCookies
                await inScope(new Request('http://example.test/'), async () => {
                    html = new TextDecoder().decode(await render(Component))
                })

                // EACH EXAMPLE GETS ITS OWN ROOT, AND THAT IS NOT DECORATION. Overwriting one
                // root for the next leaves the previous component's readers holding nodes that
                // have been deleted, and a value that lands 200 ms later — `memo-await` has one —
                // then walks a tree nobody emptied on purpose and reports against whichever
                // example happened to be mounting. A root per card is what the docs page gives it.
                const host = document.createElement('div')
                host.innerHTML = html.slice(
                    html.indexOf('<body>') + '<body>'.length,
                    html.indexOf('</body>'),
                )
                document.body.replaceChildren(host)
                const { default: mount } = await import(
                    `${dir}/${stem}.abide?client`
                )
                // A BROWSER'S COOKIES ON THE CLIENT HALF. Importing `@abide/abide/server` pointed the slot
                // at the request scope, which a browser never does, so a mount reading `cookies()`
                // would refuse as if it ran outside a request.
                COOKIES.current = browserCookies
                // The host holds the component and nothing else, so the pair `render` wrote round
                // it (41.9) is its first child and its last.
                mount({ open: host.firstChild, close: host.lastChild })
                await new Promise((resolve) => setTimeout(resolve, 0))
            } catch (thrown) {
                broken.push(
                    `${example}: ${String(thrown).split('\n')[0] ?? ''}`,
                )
            }
        }
        // ONE LONG DRAIN AT THE END, because the per-example one is a single macrotask and a value
        // can land 200 ms later. Without it a failure the LAST example defers arrives after the
        // listeners are gone, and that example is scored as running.
        await new Promise((resolve) => setTimeout(resolve, 300))
    } finally {
        globalThis.fetch = fetched
        RPC_SERVER.raw = serverRaw
        COOKIES.current = serverCookies
        console.warn = warned
        removeEventListener('error', escaped)
        removeEventListener('unhandledrejection', escaped)
        session.close()
        removeTemporaryModules()
    }

    expect(broken).toEqual([])
    expect(mismatched).toEqual([])
}, 120_000)
