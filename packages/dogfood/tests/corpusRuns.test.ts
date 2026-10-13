// EVERY EXAMPLE, RENDERED AND MOUNTED, the way its card does it: the component the card renders,
// painted on the server and adopted on the client. `abide build` asks whether each one COMPILES,
// which is a weak bar: a module that compiles can still walk to a node that is not there or throw
// on its first read. This one runs them.
//
// 68 components written before the compiler existed, using surface the rulebook decided. What they
// exercise is not what a fixture written beside the implementation exercises, which is the whole
// reason to run them rather than more of my own pages.

import { expect, test } from 'bun:test'
import { realpathSync } from 'node:fs' // bun exposes no sync realpath of its own
import { dirname, relative } from 'node:path' // bun exposes no path helpers of its own
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
import {
    resolverIn,
    withDependencies,
} from '../../abide/src/compiler/compileApp.ts'
import { inScope } from '../../abide/src/server/requestScope.ts'
import { browserCookies, COOKIES } from '../../abide/src/shared/cookies.ts'
import { RPC_SERVER } from '../../abide/src/shared/RPC_SERVER.ts'
import { placeOf, routeOf } from '../../abide/src/shared/routePattern.ts'
import {
    removeTemporaryModules,
    temporaryModule,
} from '../../abide/tests/temporaryModule.ts'
import { allCards } from './docsPages.ts'

const APP = new URL('../', import.meta.url).pathname
const TSCONFIG = `${APP}tsconfig.json`

// A file that is the site rather than an example: the docs' own components, and the route files.
function isSite(path: string): boolean {
    return (
        path.startsWith('src/docs/') ||
        /\/(page|layout|error)\.abide$/.test(path) ||
        path === 'src/downloads.abide'
    )
}

// THE DOCS APP, COMPILED WHOLE: its `package.json`, every `.ts` and `.abide` under `src/`, and every
// component compiled to the pair it becomes, served at its own path as a build serves it
// (`abideModules`). The manifest's `imports` resolve `#src/*` inside the copy, so nothing is
// rewritten on the way in. The site itself is left out: what is under test is what each card
// invokes.
async function appTree(
    session: TypeSession,
): Promise<{ tree: Record<string, string>; compilation: Compilation }> {
    const tree: Record<string, string> = {
        'package.json': await Bun.file(`${APP}package.json`).text(),
    }
    for (const path of new Bun.Glob('src/**/*.ts').scanSync({ cwd: APP }))
        if (!isSite(path)) tree[path] = await Bun.file(`${APP}${path}`).text()
    const files: { path: string; file: AbideFile }[] = []
    for (const path of new Bun.Glob('src/**/*.abide').scanSync({
        cwd: APP,
    })) {
        if (isSite(path)) continue
        // The source rides along: a handler that imports a component resolves the `.abide` itself.
        const text = await Bun.file(`${APP}${path}`).text()
        tree[path] = text
        files.push({ path: `${APP}${path}`, file: parseAbide(text) })
    }
    // 34.27 — and every `.abide` a dependency ships that one of them imports, copied in beside its
    // package's manifest, so the copy resolves it where the docs app does.
    const own = files.length
    for (const dependency of await withDependencies(
        realpathSync(`${APP}src`),
        files.map(({ path, file }) => ({
            path,
            file,
            text: '',
            quiet: false,
            position: undefined,
        })),
        resolverIn(),
    )) {
        if (files.some((one) => one.path === dependency.path)) continue
        const text = await Bun.file(dependency.path).text()
        const below = relative(APP, dependency.path)
        tree[below] = text
        const manifest = `${dirname(below)}/package.json`
        tree[manifest] ??= await Bun.file(`${APP}${manifest}`).text()
        files.push({ path: dependency.path, file: parseAbide(text) })
    }
    // 32.17 — which components another one invokes decides whether a module carries its own
    // markup for a row built in the browser. THE APP'S RESOLVER, not `Bun.resolveSync`: that asks
    // every plugin again, and a compilation an earlier file in this process served answers it from
    // the directory read as a file — `InvoiceDocument.abide` is then looked for one level up.
    const graph = componentGraph(files, resolverIn())
    const { answers } = await session.readsFor(files)
    const compilation: Compilation = { files: {}, tables: {} }
    for (let at = 0; at < files.length; at += 1) {
        const { path: absolute, file } = files[at] as (typeof files)[number]
        const names = answers[at]
        const stem = absolute.slice(APP.length, -'.abide'.length)
        const belowRoot = absolute.slice(`${APP}src/`.length)
        // 37.1 — a server block files its hooks at its route.
        const server = emitComponent(
            file,
            names,
            false,
            at < own && placeOf(belowRoot) === 'address'
                ? routeOf(belowRoot)
                : undefined,
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
        // Bound by name, as a build's stand-ins are: the file's own `<script>` calls them.
        const handlers =
            file.servers.length > 0
                ? new Bun.Transpiler({ loader: 'ts' }).scan(
                      file.servers.join('\n'),
                  ).exports
                : []
        // Through a module of the app's own, which reaches the server's module where the
        // browser's, importing it directly, would reach its own.
        if (handlers.length > 0)
            tree[`${stem}.handlers.ts`] =
                `export { ${handlers.join(', ')} } from './${name}.abide?component'\n`
        compilation.files[`${stem}.abide`] = {
            server,
            client:
                handlers.length > 0
                    ? `${client}\nimport { ${handlers.join(', ')} } from './${name}.handlers.ts'\nexport { ${handlers.join(', ')} }\n`
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
        // one before anything is called; the copy is given the address `mountHandlers` would give.
        for (const path of new Bun.Glob('src/**/*.abide').scanSync({
            cwd: APP,
        })) {
            if (
                isSite(path) ||
                placeOf(path.slice('src/'.length)) !== 'address'
            )
                continue
            const module = await import(`${dir}/${path}?component`)
            const route = routeOf(path.slice('src/'.length))
            for (const [name, handler] of Object.entries(module))
                if (typeof handler === 'function' && 'method' in handler)
                    (handler as { address?: string }).address =
                        `${route}/${name}`
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
