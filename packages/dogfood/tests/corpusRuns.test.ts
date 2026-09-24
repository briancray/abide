// EVERY EXAMPLE, RENDERED AND MOUNTED, the way its card does it: the component the manifest names,
// painted on the server and adopted on the client. `abide build` asks whether each one COMPILES,
// which is a weak bar: a module that compiles can still walk to a node that is not there or throw
// on its first read. This one runs them.
//
// 68 components written before the compiler existed, using surface the rulebook decided. What they
// exercise is not what a fixture written beside the implementation exercises, which is the whole
// reason to run them rather than more of my own pages.

import { expect, test } from 'bun:test'
import { resolve } from 'node:path' // bun has no path helpers of its own
import {
    type AbideFile,
    componentGraph,
    emitClient,
    emitComponent,
    parseAbide,
    TypeSession,
} from 'abide/compiler'
import { render } from 'abide/server'
import { inScope } from '../../abide/src/server/requestScope.ts'
import {
    removeTemporaryModules,
    temporaryModule,
} from '../../abide/tests/temporaryModule.ts'
import { type Manifest, readManifest } from '../scripts/renderExample.ts'

const APP = new URL('../', import.meta.url).pathname
const TSCONFIG = `${APP}tsconfig.json`
const SHELL = '<!doctype html><html><head></head><body></body></html>'

const examples = [...new Bun.Glob('*.json').scanSync({ cwd: `${APP}examples` })]
    .map((file) => file.slice(0, -'.json'.length))
    .sort()

// THE DOCS APP, COMPILED WHOLE: its `package.json`, every `.ts` under `src/`, and every component
// compiled to the pair it becomes. The manifest's `imports` resolve `#server` / `#shared` / `#ui`
// inside the copy, so nothing is rewritten on the way in. The generated pages are left out: they are
// the site, and what is under test is what each card invokes.
async function appTree(session: TypeSession): Promise<Record<string, string>> {
    const tree: Record<string, string> = {
        'package.json': await Bun.file(`${APP}package.json`).text(),
    }
    for (const path of new Bun.Glob('src/**/*.ts').scanSync({ cwd: APP }))
        if (!path.startsWith('src/ui/pages/'))
            tree[path] = await Bun.file(`${APP}${path}`).text()
    const files: { path: string; file: AbideFile }[] = []
    for (const path of new Bun.Glob('src/ui/components/*.abide').scanSync({
        cwd: APP,
    }))
        files.push({
            path: `${APP}${path}`,
            file: parseAbide(await Bun.file(`${APP}${path}`).text()),
        })
    // 32.18 — which components another one invokes decides whether a module carries its own
    // markup for a row built in the browser.
    const graph = componentGraph(files, (specifier, from) => {
        const seam = /^#(server|shared|ui)\//.exec(specifier)
        return seam === null
            ? resolve(from, specifier)
            : `${APP}src/${seam[1]}/${specifier.slice(seam[0].length)}`
    })
    const reads = await session.readsFor(files)
    for (let at = 0; at < files.length; at += 1) {
        const { path: absolute, file } = files[at] as (typeof files)[number]
        const names = reads[at] as Awaited<ReturnType<TypeSession['reads']>>
        const components = graph.imports.get(absolute)
        const stem = absolute.slice(APP.length, -'.abide'.length)
        tree[`${stem}.ts`] = emitComponent(file, names, false, components)
        // A CHILD WITH NOTHING TO HYDRATE STILL NEEDS A MODULE, because its caller imports one.
        // `emitClient` answers '' for a static file — that is what makes a static page ship no
        // runtime — so the no-op stands in wherever a caller has to have something to call.
        tree[`${stem}.client.ts`] =
            emitClient(
                file,
                names,
                graph.invoked.has(absolute) ? 'repeated' : 'none',
                components,
            ) || 'export default () => {}'
    }
    return tree
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

    try {
        const dir = temporaryModule(await appTree(session))
        for (const example of examples) {
            painting = example
            const manifest: Manifest = await readManifest(example)
            const stem = manifest.render.slice(0, -'.abide'.length)
            try {
                const { default: Component } = await import(`${dir}/${stem}.ts`)
                let html = ''
                // IN A REQUEST, as a page is always rendered: `principal` reads the request's
                // cookie and throws outside one (22.1).
                await inScope(new Request('http://example.test/'), async () => {
                    for await (const chunk of render(Component, SHELL))
                        html += new TextDecoder().decode(chunk)
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
                    `${dir}/${stem}.client.ts`
                )
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
        console.warn = warned
        removeEventListener('error', escaped)
        removeEventListener('unhandledrejection', escaped)
        session.close()
        removeTemporaryModules()
    }

    expect(broken).toEqual([])
    expect(mismatched).toEqual([])
}, 120_000)
