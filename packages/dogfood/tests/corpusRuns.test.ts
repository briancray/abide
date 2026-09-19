// EVERY EXAMPLE, RENDERED AND MOUNTED. `corpus.test.ts` asks whether the emitted modules PARSE,
// which is a weak bar: a module that parses can still reference a name nobody exported, walk to a
// node that is not there, or throw on its first read. This one runs them.
//
// 68 apps written before the compiler existed, using surface the rulebook decided. What they
// exercise is not what a fixture written beside the implementation exercises, which is the whole
// reason to run them rather than more of my own pages.
//
// A FLOOR RATHER THAN A LIST, which is where it parts company with its neighbour: `corpus.test.ts`
// names every file that does not compile, and most of what stops one RUNNING is runtime surface
// the rulebook decided and nobody has written, so a list of fifty would be a list of one fact. The
// cost is stated where the assertion is — a floor cannot tell a fix in one file from a regression
// in another — and the grouped output below is what a reader looks at instead.

import { expect, test } from 'bun:test'
import { relative as relativePath } from 'node:path' // bun has no path helpers of its own
import {
    emitClient,
    emitComponent,
    parseAbide,
    TypeSession,
} from 'abide/compiler'
import { render } from 'abide/server'
import {
    removeTemporaryModules,
    temporaryModule,
} from '../../abide/tests/temporaryModule.ts'

const EXAMPLES = new URL('../examples/', import.meta.url)
const TSCONFIG = new URL('../examples/tsconfig.json', import.meta.url).pathname
const SHELL = '<!doctype html><html><head></head><body></body></html>'

const sources = [
    ...new Bun.Glob('*/files/**/*.abide').scanSync({ cwd: EXAMPLES.pathname }),
].sort()

// `#server/x` as a path from `from` — a file's directory inside the copied tree, '' at its root —
// to the copy of `src/server/x.ts`.
function seams(module: string, from: string): string {
    return module.replace(
        /from '#(server|shared|ui)(\/[^']*)?'/g,
        (_, seam: string, rest: string | undefined) => {
            const target = `src/${seam}${rest === undefined ? '/index' : rest}.ts`
            const path = relativePath(from === '' ? '.' : from, target)
            return `from '${path.startsWith('.') ? path : `./${path}`}'`
        },
    )
}

// Every `.ts` under an example's `files/src`, keyed by where it goes in the copy.
async function exampleTree(example: string): Promise<Record<string, string>> {
    const root = new URL(`${example}/files/`, EXAMPLES).pathname
    const tree: Record<string, string> = {}
    for (const path of new Bun.Glob('src/**/*.ts').scanSync({ cwd: root }))
        tree[path] = seams(
            await Bun.file(`${root}${path}`).text(),
            path.slice(0, path.lastIndexOf('/')),
        )
    return tree
}

test('every example renders on the server and mounts on the client', async () => {
    const session = await TypeSession.open(TSCONFIG)
    const broken: string[] = []

    // A MOUNT'S FAILURE CAN ARRIVE AFTER THE MOUNT. The effects a mount schedules run in a later
    // turn, so a page that throws there throws outside the `try` below and the file was counted as
    // RUNNING. Nothing here can tear a mount down — the emitted `mount` hands back no disposer —
    // so the escape is caught and counted instead, and the drain after each mount is what puts it
    // in the right file's turn.
    //
    // EACH FILE GETS ITS OWN ROOT, AND THAT IS NOT DECORATION. Mounting every page into
    // `document.body` and then overwriting `innerHTML` for the next one leaves the PREVIOUS page's
    // readers holding a root whose children have been deleted, and a value that lands 200 ms later
    // — `memo-await` has one — then walks a tree nobody emptied on purpose. It reported
    // `no node at [1,0,2,0]` against whichever file happened to be mounting at the time, which is
    // not even the file that owns the binding: run alone, that page renders
    // `showing 12 of 12 for all`. A root per file is what a browser gives each page anyway.
    //
    // ON THE WINDOW, NOT ON THE PROCESS. happy-dom wraps every queued task in its own try/catch
    // and turns a throw into an `error` event it also prints, so `process.on('uncaughtException')`
    // never sees one — tried, and the count did not move.
    const escaped = (event: Event): void => {
        const thrown =
            (event as ErrorEvent).error ??
            (event as PromiseRejectionEvent).reason
        broken.push(String(thrown).split('\n')[0] ?? '')
    }
    addEventListener('error', escaped)
    addEventListener('unhandledrejection', escaped)

    try {
        for (const relative of sources) {
            const path = new URL(relative, EXAMPLES).pathname
            const text = await Bun.file(path).text()
            try {
                const file = parseAbide(text)
                const names = await session.reads(path, file)
                // EACH EXAMPLE IS ITS OWN APP, with its own `#server` / `#shared` / `#ui`, and a
                // temp directory is not that app. So the example's WHOLE `src` is copied beside the
                // page with every module's seam specifiers rewritten to the copy — not the page's
                // alone. Rewriting only the page left a handler's own `#server/database` to
                // resolve through `packages/dogfood/package.json`, to the DOCS APP's database, and
                // an example ran against another app's module with nothing saying so. An `imports`
                // map was tried and bun did not resolve one pointing outside its own package; a
                // runtime `onResolve` does not fire for a bare `#shared` that fails its lookup.
                const example = relative.slice(0, relative.indexOf('/files/'))
                const tree = await exampleTree(example)
                const dir = temporaryModule({
                    ...tree,
                    'Page.ts': seams(emitComponent(file, names), ''),
                    'Page.client.ts': seams(
                        emitClient(file, names) || 'export default () => {}',
                        '',
                    ),
                })

                const { default: Component } = await import(`${dir}/Page.ts`)
                let html = ''
                for await (const chunk of render(Component, SHELL))
                    html += new TextDecoder().decode(chunk)

                const host = document.createElement('div')
                host.innerHTML = html.slice(
                    html.indexOf('<body>') + '<body>'.length,
                    html.indexOf('</body>'),
                )
                document.body.replaceChildren(host)
                const { default: mount } = await import(`${dir}/Page.client.ts`)
                mount(host)
                await new Promise((resolve) => setTimeout(resolve, 0))
            } catch (thrown) {
                broken.push(String(thrown).split('\n')[0] ?? '')
            }
        }
        // ONE LONG DRAIN AT THE END, because the per-file one is a single macrotask and the
        // comment above names a value that lands 200 ms later. Without it a failure the LAST
        // file defers arrives after the listeners are gone, and that file is scored as running.
        await new Promise((resolve) => setTimeout(resolve, 300))
    } finally {
        removeEventListener('error', escaped)
        removeEventListener('unhandledrejection', escaped)
        session.close()
        removeTemporaryModules()
    }

    // GROUPED BY WHAT IS MISSING, not listed per file. Fifty lines saying `Export named 'GET' not
    // found` is one fact about the rpc surface, and reading it as fifty problems is how a work
    // queue turns into a wall.
    const reasons = new Map<string, number>()
    for (const line of broken) {
        const missing = /Export named '([^']+)'/.exec(line)
        // A module the example never shipped — the `database.ts` its handlers import is not in
        // `files/` — and a package nothing installed are facts about the CORPUS, not the runtime.
        const absent =
            /Cannot find (module|package) '(?:[./]*\/)?([^']+)'/.exec(line)
        const key =
            missing !== null
                ? `\`${missing[1]}\` is not exported — that surface is not built`
                : absent !== null
                  ? `\`${absent[2]}\` ${absent[1] === 'module' ? 'is not in the example' : 'is not installed'} — the corpus is missing it`
                  : (line.split(':')[0] ?? line)
        reasons.set(key, (reasons.get(key) ?? 0) + 1)
    }
    const ranked = [...reasons].sort((left, right) => right[1] - left[1])

    console.log(
        [
            `\n  ${sources.length - broken.length} of ${sources.length} sources render and mount.`,
            '  What stops the rest, and it is mostly not the compiler:',
            ...ranked.map(
                ([reason, count]) =>
                    `    ${String(count).padStart(3)}  ${reason}`,
            ),
        ].join('\n'),
    )

    // A FLOOR, ratcheted. It is not a pass/fail of the corpus — most of what is missing is
    // runtime surface the rulebook decided and nobody has written — but it must not go DOWN, and
    // a change that takes it up should move this number in the same commit.
    //
    // 35 AFTER THE REGION ADDRESSING WAS DEEPENED, and the +2 is the root-per-file above rather
    // than the compiler: nothing in this corpus nests a region or renders a text run empty beside
    // a sibling, which is exactly why those shapes went unbuilt — `nesting.test.ts` is where they
    // are held now. THE FLOOR IS WHAT THE CORPUS REACHES, not a round number under it: one unit
    // of slack is one file that may stop running with nothing reporting it.
    //
    // 37 ONCE 31.3's DECLARED POSITIONS HOLD THE `Reactive`: `watch([owner], …)` had lowered its
    // source to a read, and `watch` walked the readers of a string.
    //
    // 44 WITH `GET` AND THE MUTATIONS IN PROCESS. It read 51 first, and 7 of those were the docs
    // app's database answering an example's handler — see `exampleTree`.
    expect(sources.length - broken.length).toBeGreaterThanOrEqual(44)
})
