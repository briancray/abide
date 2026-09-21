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
    invokedComponents,
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

// The tag a component's own failure carries out of the loop. A marker rather than a message test:
// see where it is pushed.
const NO_CALLER = '[no caller]'

const sources = [
    ...new Bun.Glob('*/files/**/*.abide').scanSync({ cwd: EXAMPLES.pathname }),
].sort()

// `#server/x` as a path from `from` — a file's directory inside the copied tree, '' at its root —
// to the copy of `src/server/x.ts`.
function seams(module: string, from: string): string {
    return module.replace(
        /from '#(server|shared|ui)(\/[^']*)?'/g,
        (_, seam: string, rest: string | undefined) => {
            // A SPECIFIER MAY ALREADY CARRY ITS EXTENSION. 32.19's `.abide` import is rewritten by
            // the compiler to the module that file becomes, so appending here made `Total.ts.ts`.
            const named = rest === undefined ? '/index' : rest
            const target = `src/${seam}${named}${named.endsWith('.ts') ? '' : '.ts'}`
            const path = relativePath(from === '' ? '.' : from, target)
            return `from '${path.startsWith('.') ? path : `./${path}`}'`
        },
    )
}

// AN EXAMPLE, COMPILED WHOLE: every `.ts` copied and every `.abide` compiled to the pair it
// becomes, each keyed by where it goes in the copy. A page that invokes a component (32.19) imports
// the module its child compiled to, so compiling the page alone leaves that import pointing at a
// `.abide` nothing can load — which is a fact about the harness rather than about the page.
async function exampleTree(
    example: string,
    session: TypeSession,
): Promise<Record<string, string>> {
    const root = new URL(`${example}/files/`, EXAMPLES).pathname
    const tree: Record<string, string> = {}
    for (const path of new Bun.Glob('src/**/*.ts').scanSync({ cwd: root }))
        tree[path] = seams(
            await Bun.file(`${root}${path}`).text(),
            path.slice(0, path.lastIndexOf('/')),
        )
    const abide = [...new Bun.Glob('src/**/*.abide').scanSync({ cwd: root })]
    // 32.19 — which of the example's files another one invokes, which is what decides whether a
    // module carries its own markup for a row built in the browser.
    const invoked = invokedComponents(
        await Promise.all(
            abide.map((path) => Bun.file(`${root}${path}`).text()),
        ),
    )
    for (const path of abide) {
        const from = path.slice(0, path.lastIndexOf('/'))
        const file = parseAbide(await Bun.file(`${root}${path}`).text())
        const reads = await session.reads(`${root}${path}`, file)
        const stem = path.slice(0, -'.abide'.length)
        tree[`${stem}.ts`] = seams(emitComponent(file, reads), from)
        // A CHILD WITH NOTHING TO HYDRATE STILL NEEDS A MODULE, because its caller imports one.
        // `emitClient` answers '' for a static file — that is what makes a static page ship no
        // runtime — so the no-op stands in wherever a caller has to have something to call.
        tree[`${stem}.client.ts`] = seams(
            emitClient(
                file,
                reads,
                invoked.has(path.slice(path.lastIndexOf('/') + 1)),
            ) || 'export default () => {}',
            from,
        )
    }
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

    // WHICH FILES ARE COMPONENTS, per example. A component is INVOKED by another file and is
    // exercised through it; mounted on its own it has no caller, so `props()` answers {} and a
    // required prop is `undefined` — which is this test asking a component to be a page rather
    // than anything about abide. Computed once per example because the answer is the example's.
    const componentsOf = new Map<string, Set<string>>()
    for (const example of new Set(
        sources.map((path) => path.slice(0, path.indexOf('/files/'))),
    )) {
        const root = new URL(`${example}/files/`, EXAMPLES).pathname
        const abide = [
            ...new Bun.Glob('src/**/*.abide').scanSync({ cwd: root }),
        ]
        componentsOf.set(
            example,
            invokedComponents(
                await Promise.all(
                    abide.map((path) => Bun.file(`${root}${path}`).text()),
                ),
            ),
        )
    }

    try {
        for (const relative of sources) {
            const example = relative.slice(0, relative.indexOf('/files/'))
            try {
                // EACH EXAMPLE IS ITS OWN APP, with its own `#server` / `#shared` / `#ui`, and a
                // temp directory is not that app. So the example's WHOLE `src` is copied and
                // compiled with every module's seam specifiers rewritten to the copy — not the
                // page's alone. Rewriting only the page left a handler's own `#server/database` to
                // resolve through `packages/dogfood/package.json`, to the DOCS APP's database, and
                // an example ran against another app's module with nothing saying so. An `imports`
                // map was tried and bun did not resolve one pointing outside its own package; a
                // runtime `onResolve` does not fire for a bare `#shared` that fails its lookup.
                const dir = temporaryModule(await exampleTree(example, session))
                // THE FILE UNDER TEST IS THE ONE IN THE TREE, at its own path rather than at the
                // root of the copy: a component's caller reaches it by the path it was written
                // with, and a page lifted to the root is a page whose relative imports mean
                // something else.
                const stem = relative
                    .slice(relative.indexOf('/files/') + '/files/'.length)
                    .slice(0, -'.abide'.length)

                const { default: Component } = await import(`${dir}/${stem}.ts`)
                let html = ''
                for await (const chunk of render(Component, SHELL))
                    html += new TextDecoder().decode(chunk)

                const host = document.createElement('div')
                host.innerHTML = html.slice(
                    html.indexOf('<body>') + '<body>'.length,
                    html.indexOf('</body>'),
                )
                document.body.replaceChildren(host)
                const { default: mount } = await import(
                    `${dir}/${stem}.client.ts`
                )
                mount(host)
                await new Promise((resolve) => setTimeout(resolve, 0))
            } catch (thrown) {
                const line = String(thrown).split('\n')[0] ?? ''
                // TAGGED HERE, not matched on the message later: what makes this a corpus fact is
                // WHICH FILE it is, and the message is an engine's phrasing for `undefined()`.
                const base = relative.slice(relative.lastIndexOf('/') + 1)
                broken.push(
                    componentsOf.get(example)?.has(base) === true
                        ? `${NO_CALLER} ${line}`
                        : line,
                )
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
        // A REFUSAL NAMES ITS CLAUSE, so the group is the clause rather than the word `Error` —
        // what the compiler refuses on purpose reads apart from what fell over.
        const refused = /abide: .*RULEBOOK (\d+\.\d+)/.exec(line)
        // A NAMED CAUSE BEATS "IT IS A COMPONENT". Asked first, the tag took two `principal`
        // failures with it — a component that falls over on surface nobody built IS that missing
        // surface, and calling it a caller problem hides the one fact worth having. So the tag is
        // the last thing asked, after every cause that names itself.
        const key =
            refused !== null
                ? `refused by RULEBOOK ${refused[1]} — that shape is not built`
                : missing !== null
                  ? `\`${missing[1]}\` is not exported — that surface is not built`
                  : absent !== null
                    ? `\`${absent[2]}\` ${absent[1] === 'module' ? 'is not in the example' : 'is not installed'} — the corpus is missing it`
                    : line.startsWith(NO_CALLER)
                      ? 'a component mounted with no caller — it is exercised through the page that invokes it'
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
    //
    // 40 WITH COMPONENTS, AND THE NUMBER WENT DOWN BECAUSE THE MEASUREMENT GOT HONEST — the same
    // way it did at 51 -> 44. A page invoking `<TrackRow/>` used to emit the tag as MARKUP: the
    // child never ran, so whatever it needed was never missed and the page counted as running.
    // The child is compiled and invoked now, so a page is worth what its components are worth —
    // six of them want `reactive.share`, which is not built. The other two are components whose
    // props nobody passes, this corpus having no caller for a file it compiles on its own.
    //
    // 43 WITH `reactive.share`: six pages wanted it, and three of those spent the gain again on
    // the refusal that stood beside it for one change — a component inside a `{#for}`.
    //
    // 45 ONCE A COMPONENT IN A ROW BUILDS ITSELF. The caller writes the anchor pair and the child
    // fills it from its own template, which is what a list of components needs and what the
    // refusal was standing in for.
    //
    // 55 ONCE THE EXAMPLES SHIP THE `database.ts` THEIR HANDLERS IMPORT. The biggest group here
    // was never a fact about abide: 23 files stopped at a module the example does not contain,
    // which is this test reporting the corpus to itself. Clearing it moved ten files and, more to
    // the point, made the rest of the list mean something — what stood at the top after it was
    // twelve pages reading an unlanded value (2.2) where the throw escapes as a rejection instead
    // of the tracked body catching it, and that IS a fact about abide.
    //
    // 67 ONCE A RENDER CONTINUES PAST A VALUE STILL IN FLIGHT (41.4). The throw took the whole
    // document with it; the position aborts now and the document is served with a hole. The
    // twelve were text slots and `{#for}` subjects, and `element-ref` behind them is the one page
    // reading an unlanded value from an ATTRIBUTE — the page that showed guarding the two shapes
    // that had been TRIED was not the same as guarding the class. ALL FIVE MARKUP POSITIONS ARE
    // GUARDED now; no corpus page reads an unlanded `{#if}` subject, which is exactly the kind of
    // gap a floor cannot report.
    //
    // `element-ref` RENDERS `bind:element=""` INTO THE MARKUP, inert and ignored by a browser:
    // the compiler has no `bind:` handling at all, so a `bind:` attribute falls through the
    // ordinary computed path. 32.6-32.10 are that surface and none of it is built.
    //
    // THE FLOOR DID NOT MOVE FOR THE GROUPING, and that is the point of it. What had been the
    // biggest bucket left was five `TypeError`s, which read as five faults in abide and were one
    // fact about this test: it globs EVERY `.abide` and mounts each on its own, so a component
    // gets no caller, `props()` answers {} and a required prop is `undefined`. Those five
    // components are already exercised through the pages that invoke them — every one of those
    // pages renders. Naming the group changes no count; it stops the list claiming five bugs
    // that are not there, and the list is what this test is FOR.
    //
    // A RATCHET STILL, and the direction is the rule: this may not go down under a change that
    // does not change what is being counted.
    expect(sources.length - broken.length).toBeGreaterThanOrEqual(67)
})
