// 38.4 — `abide dev`, end to end: the command is spawned, a browser's worth of requests are made
// against it, and the project is EDITED underneath it. The edit is the whole point — every other
// arm of this file would pass against `abide start` with a watcher bolted on, and what the clause
// asks for is that the app a reader gets after a save is the app the source now says.
//
// THE SERVER IS A SUBPROCESS for `serve.test.ts`'s reasons: `bunfig.toml` preloads happy-dom over
// every test file, `Bun.serve` refuses a `Response` it did not define, and the command a host
// runs is the more honest arm anyway. `Bun.fetch` for the same clobbering on the other side.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { decodeMappings, segmentAt } from '#server/sourceMappings.ts'
import { addressOf, BIN } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const HOME = `<script>
import { reactive } from '@abide/abide'
import '#src/lib/home.css'

let count = reactive(0)
</script>

<head><title>Home</title></head>
<main id="home"><h1>Home</h1><p id="n">{count}</p></main>`

const PACKAGE = JSON.stringify({
    name: 'dev-fixture',
    type: 'module',
    imports: {
        '#src/*': './*',
    },
})

// A SEAM WRITTEN THE WAY AN APP WRITES IT: extensionless, which is the spelling only the second
// target of the manifest's `imports` answers.
const SEAM_PAGE = `<script>
import { greeting } from '#src/lib/greeting'
</script>

<main id="seam">{greeting()}</main>`

const TSCONFIG = JSON.stringify({
    compilerOptions: {
        strict: true,
        target: 'esnext',
        module: 'preserve',
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        types: [],
    },
    include: ['**/*'],
})

let server: Bun.Subprocess | undefined
// What the server and its worker have written to stderr so far, read as it arrives.
let serverSaid = ''
let base = ''
let app = ''

beforeAll(async () => {
    app = temporaryModule({
        'index.abide': HOME,
        'seam/index.abide': SEAM_PAGE,
        'lib/greeting.ts':
            "export function greeting(): string {\n    return 'from the shared seam'\n}\n",
        // 36.15 — a URL naming a public file, left as its address rather than resolved on disk.
        'lib/home.css':
            ".fixture-sheet-was-imported { color: red }\n.fixture-uses-public { background: url('/robots.txt') }",
        // 38.19 — IN THE SOURCE TREE AND NOWHERE ELSE. Nothing copies this anywhere, because
        // nothing builds: an address answering it is the clause and a stale copy cannot pass it.
        'public/robots.txt': 'User-agent: *\nAllow: /\n',
        // A COUNT A RESTART WOULD RESET, so surviving is told apart from being replaced (37.9, 38.41).
        'lib/served.ts':
            'let served = 0\nexport function serve(): number {\n    served += 1\n    return served\n}\n',
        'served/index.abide': `<script>
import { serve } from '#src/lib/served'

const served = serve()
</script>

<main id="served">{served}</main>`,
        'orphan/index.abide': `<script>
Promise.reject(new Error('nobody awaited this'))
</script>

<main id="orphan">orphaned</main>`,
        // A HANDLER TREE FROM THE START, so a handler saved later lands in a directory the checker
        // already knows.
        'present/present.ts':
            "import { GET } from '@abide/abide/server'\n\nexport default GET(() => 'here')\n",
        // 38.4 — an extensionless RELATIVE import out of a server block, which the runtime takes
        // itself rather than through dev's plugin. A private handler (16.70), so the module that
        // imports is the compiled `.abide`'s.
        'relative/index.abide':
            "<script server>\nimport { GET } from '@abide/abide/server'\nimport { greeting } from '../lib/greeting'\n\nconst hello = GET(() => greeting())\n</script>\n",
        // 38.97 — a stack read on the server, and a line the browser's map places.
        'mapped/index.abide': `<script server>
import { GET } from '@abide/abide/server'

const where = GET(() => new Error('placed').stack ?? '')
</script>

<script>
const marker = 'mapped-marker'
</script>

<main id="mapped">{marker}</main>`,
        'exit/index.abide': `<script>
process.exit(3)
</script>

<main id="exit"/>`,
        'package.json': PACKAGE,
        'tsconfig.json': TSCONFIG,
    })
    server = Bun.spawn(['bun', BIN, 'dev', '--root', app, '--port', '0'], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const decoder = new TextDecoder()
    const stderr = server.stderr as ReadableStream<Uint8Array>
    const told = (async () => {
        for await (const chunk of stderr) serverSaid += decoder.decode(chunk)
        return serverSaid
    })()
    base = await addressOf(server, () => told)
}, 30_000)

afterAll(() => {
    server?.kill()
    removeTemporaryModules()
})

// A save, and the first answer that carries it. The watcher settles before it replaces the
// worker, so the poll is what the browser's own reload does — and a timeout here is the failure
// rather than a flake, since nothing else in the loop is timing-dependent.
async function save(name: string, text: string): Promise<void> {
    await Bun.write(`${app}/${name}`, text)
}

async function waitFor(
    address: string,
    holds: (body: string) => boolean,
): Promise<string> {
    return await waitUntil(
        async () => await received(await Bun.fetch(address)),
        holds,
        address,
    )
}

// WHAT ARRIVED, where a body can end in an error: one a reload cut short does (38.37), with what
// broke streamed ahead of the error — which is what a browser shows.
async function received(response: Response): Promise<string> {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let text = ''
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) return text
            text += decoder.decode(value, { stream: true })
        }
    } catch {
        return text
    }
}

async function waitUntil(
    read: () => Promise<string>,
    holds: (body: string) => boolean,
    what: string,
): Promise<string> {
    const until = Date.now() + 15_000
    let last = ''
    while (Date.now() < until) {
        last = await read()
        if (holds(last)) return last
        await Bun.sleep(50)
    }
    throw new Error(`${what} never satisfied the test: ${last}`)
}

// THE PAGE'S OWN CHUNK, which is where its markup is: the table's loaders are dynamic imports so
// a destination stays off the entry's bytes (30.11), and an assertion against `entry.js` reads a
// module the page's markup was never in. Named by the home document's own preload (38.28) rather
// than by the entry's first loader, which is whichever page the bundler listed first.
async function pageChunk(): Promise<string> {
    const home = await (await Bun.fetch(`${base}/`)).text()
    const found = /\/(index\.client-[^"]+\.js)"/.exec(home)
    if (found === null) return home
    return await (
        await Bun.fetch(`${base}/__abide/client/${found[1] as string}`)
    ).text()
}

// Every file under the app, so "writes nothing to disk" is asserted against the whole tree rather
// than against the one directory a build happens to use.
function tree(): string[] {
    return [
        ...new Bun.Glob('**/*').scanSync({ cwd: app, onlyFiles: true }),
    ].sort()
}

test('a page is painted by the command with no build in front of it — 38.4', async () => {
    const response = await Bun.fetch(`${base}/`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<main id="home"><h1>Home</h1>')
    expect(html).toContain('<title>Home</title>')
    // The shell is the app's, not a document the command invented.
    expect(html).toContain('<meta charset="utf-8">')
})

// 41.1 — A PAGE IS BUILT WHOLE BEFORE IT IS SENT, so it goes out with its length even through the
// worker's chunk-by-chunk relay (38.35). THE REVERT: drop the `content-length` `answerRequest` sets on a
// page, or send the body after its head rather than with it in `answerAsk`; either way it goes out
// chunked, with no length.
test('a page arrives with its length rather than chunked — 41.1', async () => {
    const response = await Bun.fetch(`${base}/`)
    const body = new Uint8Array(await response.arrayBuffer())
    expect(response.headers.get('transfer-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBe(String(body.byteLength))
})

// AN EXTENSIONLESS SEAM IMPORT RESOLVES UNDER DEV AS IT DOES IN A BUILD. The runtime takes a `#`
// specifier from a compiled module as an exact file, so `#src/lib/greeting` found nothing and the
// page was the error document — while `abide build`, whose bundler probes, served it.
//
// THE REVERT: drop `withSeamsResolved` from the dev plugin's `onLoad`; the page answers the error
// document naming `#shared`.
test('a page importing an extensionless seam is painted — 38.4', async () => {
    const html = await (await Bun.fetch(`${base}/seam`)).text()
    expect(html).toContain('<main id="seam">from the shared seam</main>')
})

// 34.14 — RESOLVED FROM THE FILE THAT WROTE IT, the compiled module being served at the `.abide`'s
// own path (`abideModules`). THE REVERT: serve a component module at a path of its own below
// `__abide`; the relative import resolves from there, and the whole app answers dev's failure page.
test('a server block importing an extensionless relative module answers — 38.4', async () => {
    const answer = await Bun.fetch(
        `${base}/__abide/handlers/relative/index/hello`,
    )
    expect(await answer.text()).toContain('from the shared seam')
})

// 38.97 — A FRAME IN A COMPILED MODULE NAMES THE `.abide`, at the line the `new Error` is written on.
// THE REVERT: `installSourceMaps` out of `originUnder`; the frame names `__abide/mapped/index.ts`.
test('a stack read on the server names the .abide line — 38.97', async () => {
    const stack = await (
        await Bun.fetch(`${base}/__abide/handlers/mapped/index/where`)
    ).text()
    expect(stack).toContain('mapped/index.abide:4:')
})

// 38.97 — THE BROWSER'S MAP READS THE `.abide`: the chunk's position of the script's own line is
// placed on it. THE REVERT: drop `withAbideSources` from `bundleInMemory`; the map places it in
// the compiled `index.client.ts`.
test("a client chunk's source map places a script line in the .abide — 38.97", async () => {
    const html = await (await Bun.fetch(`${base}/mapped`)).text()
    let placed = ''
    for (const chunk of new Set(html.match(/\/__abide\/client\/[^"]+\.js/g))) {
        const lines = (await (await Bun.fetch(`${base}${chunk}`)).text()).split(
            '\n',
        )
        const line = lines.findIndex((text) => text.includes('mapped-marker'))
        if (line === -1) continue
        const map = await (await Bun.fetch(`${base}${chunk}.map`)).json()
        const column = (lines[line] as string).indexOf('mapped-marker')
        const segment = segmentAt(decodeMappings(map.mappings), line, column)
        if (segment !== undefined)
            placed = `${map.sources[segment[1]]}:${segment[2] + 1}`
    }
    expect(placed).toEndWith('mapped/index.abide:8')
})

// 16.28, 34.19 — THE MAP CARRIES THE `.abide` WITHOUT ITS SERVER BLOCK: it is served to a browser.
// THE REVERT: list the `.abide`'s text whole in `withAbideSources`; the handler's body is in it.
test("a client chunk's source map carries none of a server block — 16.28, 34.19", async () => {
    const html = await (await Bun.fetch(`${base}/mapped`)).text()
    let listed = ''
    for (const chunk of new Set(html.match(/\/__abide\/client\/[^"]+\.js/g))) {
        const map = await (await Bun.fetch(`${base}${chunk}.map`)).json()
        for (const text of map.sourcesContent ?? []) listed += text ?? ''
    }
    expect(listed).toContain("const marker = 'mapped-marker'")
    expect(listed).not.toContain("new Error('placed')")
})

// 28.4 IN DEV — THE DOCUMENT NAMES THE APP its configuration resolved, as `abide start`'s does: dev
// read its sources before the boot resolved the configuration and named every document `app`.
// THE REVERT: read `appSources` ahead of `bootApp` in `devWorker`'s `open`; the meta says `app`.
test('a dev document carries the app name its configuration resolved — 28.4', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain('<meta name="abide-app" content="dev-fixture">')
})

// 38.16 — IN MEMORY, AND NAMED BY ITS SOURCE. `entry.js` rather than a content hash is what makes
// a stack trace name the module the author wrote, and it is the one place dev parts company with
// 38.5's hashed chunks on purpose.
test('the client is built into memory and answered under the bundle address — 38.16, 38.20', async () => {
    const entry = await Bun.fetch(`${base}/__abide/client/entry.js`)
    expect(entry.status).toBe(200)
    const text = await entry.text()
    expect(text).toContain('startRouter')
    // UNMINIFIED, asserted as a name a minifier takes: the clause is about what an author can
    // read in a debugger, and a byte count would pass on a whitespace difference.
    expect(text).toContain('hydrate')

    const sheet = await Bun.fetch(`${base}/__abide/client/entry.css`)
    expect(sheet.status).toBe(200)
    const styles = await sheet.text()
    expect(styles).toContain('.fixture-sheet-was-imported')
    // 36.15. THE REVERT: drop `external` from `bundleInMemory` and the bundle fails, so there is
    // no stylesheet to read at all. Relative to the sheet (16.10), read as the browser reads it.
    const named = /url\(["']?([^"')]+)/.exec(styles)?.[1] as string
    expect(new URL(named, sheet.url).pathname).toBe('/robots.txt')
})

// 38.28 IN DEV TOO, where the manifest is keyed off the plugin's namespace rather than a path on
// disk — a key that misses reads as a route with nothing to preload, and the page still hydrates.
// THE REVERT: drop the namespace strip from `manifestOf` and no chunk carries the page.
test('the document preloads the chunk its own page is in — 38.28', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    const head = html.slice(0, html.indexOf('<body>'))
    const preloaded: string[] = []
    for (const match of head.matchAll(
        /<link rel="modulepreload" href="\/__abide\/client\/([^"]+)">/g,
    ))
        preloaded.push(match[1] as string)
    const bodies: string[] = []
    for (const chunk of preloaded)
        bodies.push(
            await (await Bun.fetch(`${base}/__abide/client/${chunk}`)).text(),
        )
    expect(bodies.some((body) => body.includes('id="home"'))).toBe(true)
})

// THE REVERT: hand `Bun.build` an `outdir` and this reports the tree it left behind. Nothing a
// reader sees moves — the same bundle is served either way — which is why it is asserted.
test('the command writes nothing to disk — 38.16', async () => {
    const before = tree()
    await Bun.fetch(`${base}/`)
    await Bun.fetch(`${base}/__abide/client/entry.js`)
    expect(tree()).toEqual(before)
    expect(before.some((name) => name.startsWith('.abide/'))).toBe(false)
    expect(before.some((name) => name.includes('__abide'))).toBe(false)
})

test('a file under public is answered out of the source tree — 38.19', async () => {
    const robots = await Bun.fetch(`${base}/robots.txt`)
    expect(robots.status).toBe(200)
    expect(await robots.text()).toBe('User-agent: *\nAllow: /\n')
})

// 38.17 — SERVED BY THE DEV WORKER, which is what its address says: it is not in the bundle, it
// is not in the app, and it reaches a document whose bundle failed to build.
test('the document loads a reload client the worker serves — 38.17', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain(
        '<script type="module" src="/__abide/dev/client.js"></script>',
    )
    const client = await Bun.fetch(`${base}/__abide/dev/client.js`)
    expect(client.status).toBe(200)
    expect(await client.text()).toContain('WebSocket')
})

// THE CLAUSE ITSELF. Everything above holds for a server that read the project once.
test('a save reaches the next request — 38.4, 38.15', async () => {
    await save('index.abide', HOME.replace('<h1>Home</h1>', '<h1>Saved</h1>'))
    expect(
        await waitFor(`${base}/`, (body) => body.includes('Saved')),
    ).toContain('<h1>Saved</h1>')

    // AND THE BUNDLE IS THE NEW ONE TOO. The document and the bundle are built by the same
    // worker, so a reload that served new markup against a stale bundle is a hydration mismatch
    // on every page — and the markup arm alone cannot see it.
    await waitUntil(pageChunk, (body) => body.includes('Saved'), 'the bundle')
    await save('index.abide', HOME)
    await waitFor(`${base}/`, (body) => body.includes('Home'))
}, 30_000)

// THE CHECKER IS KEPT ACROSS SAVES, so what a page's names ARE can be decided by a file the
// compiler never writes: `total` below is static until a save to a plain `.ts` makes it a
// `Reactive`, and a page reading it has to be compiled against the new type — a checker answering
// from what it cached at boot paints the reactive as though it were the value.
//
// THE REVERT: drop the `session.edited(…)` call in `AppChecker.current` and the second
// wait times out on a page painting the reactive's own function source where its 8 was due.
test('an edit to a plain .ts reaches the types the next compile reads — 31.3, 38.4', async () => {
    const reading = HOME.replace(
        'let count = reactive(0)',
        "import { total } from '#src/lib/total.ts'\nlet count = reactive(0)\nlet shown = total",
    ).replace('<h1>Home</h1>', '<h1>Home</h1><p id="total">{shown}</p>')
    await save('lib/total.ts', 'export const total = 7\n')
    await save('index.abide', reading)
    await waitFor(`${base}/`, (body) => body.includes('<p id="total">7</p>'))

    await save(
        'lib/total.ts',
        "import { reactive } from '@abide/abide'\nexport const total = reactive(8)\n",
    )
    expect(
        await waitFor(`${base}/`, (body) =>
            body.includes('<p id="total">8</p>'),
        ),
    ).toContain('<p id="total">8</p>')

    // ONE SAVE TO PUT IT BACK, and `total.ts` left where it is: a second event here can land after
    // the wait below is satisfied, and the reload it starts is the next test's socket refused.
    await save('index.abide', HOME)
    await waitFor(`${base}/`, (body) => !body.includes('id="total"'))
}, 45_000)

// 38.15 — THE FORCE-CLOSE, which is the whole reload protocol: nothing is sent over this socket
// and its LIFE is the message. THE REVERT: drop the `terminate` loop from `replace` and the
// socket stays open across the save, so a browser waits for a reload that never comes.
test('a live socket is force-closed when the worker is replaced — 38.15', async () => {
    const socket = new WebSocket(`${base.replace('http', 'ws')}/__abide/dev`)
    await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => {
            resolve()
        })
        socket.addEventListener('error', () => {
            reject(new Error('the dev socket refused the upgrade'))
        })
    })

    const closed = new Promise<void>((resolve) => {
        socket.addEventListener('close', () => {
            resolve()
        })
    })
    await save('index.abide', HOME)
    await closed
}, 30_000)

// 38.4 — KEEP THE APP UP. A source that does not compile is the common case in a dev loop, and a
// command that exits on one is a command an author restarts by hand every time they typo.
test('a source that does not compile keeps the server up — 38.4', async () => {
    await save('index.abide', '<script>\nlet x = (\n</script>\n<main/>')
    const failed = await waitFor(`${base}/`, (body) =>
        body.includes('abide dev'),
    )
    expect(failed).toContain('abide dev')

    await save('index.abide', HOME)
    expect(
        await waitFor(`${base}/`, (body) => body.includes('Home')),
    ).toContain('<h1>Home</h1>')
}, 30_000)

// 38.14 — AN IMPORT SAVED BEFORE ITS MODULE EXISTS recovers once the module does. Bun's resolver
// remembers a file it failed to find for the life of the process, so while the app was a worker
// thread every reload inherited the miss and the page stayed broken until the command restarted.
// THE REVERT: hold the app in a `Worker` again; the last wait times out on the failure document.
test('an import saved before its module exists recovers when the module is written — 38.14', async () => {
    // A HANDLER, which the app imports at boot and bun resolves itself — the shape that met it: a
    // compiled page's imports go through abide's plugin, which asks the disk every time.
    await save(
        'present/readLate.ts',
        "import { GET } from '@abide/abide/server'\nimport { late } from '#src/lib/late'\n\nexport default GET(() => late)\n",
    )
    expect(
        await waitFor(`${base}/present/readLate`, (body) =>
            body.includes('Cannot find'),
        ),
    ).toContain('Cannot find')
    await save('lib/late.ts', "export const late = 'arrived'\n")
    expect(
        await waitFor(`${base}/present/readLate`, (body) =>
            body.includes('arrived'),
        ),
    ).toBe('"arrived"')
}, 30_000)

// A SECOND APP, AND IT EARNS THE SECOND BOOT: a client build that fails cannot be provoked in an
// app whose pages all resolve, and the failure has to be there at BOOT for the clause to be about
// the server staying up rather than about a reload recovering.
let broken: Bun.Subprocess | undefined
let brokenBase = ''

beforeAll(async () => {
    const dir = temporaryModule({
        'index.abide': HOME,
        'seam/index.abide': SEAM_PAGE,
        'lib/greeting.ts':
            "export function greeting(): string {\n    return 'from the shared seam'\n}\n",
        // THE BROWSER GRAPH ALONE. A route's module is imported lazily on the server, so this
        // page is never loaded by the arm below — and the bundler follows every dynamic import
        // in the table, so the bundle it builds is the thing that fails.
        'broken/index.abide': `<script>
import '#src/lib/nothing-is-here.css'
</script>

<main id="broken"/>`,
        'lib/home.css': '.fixture-sheet-was-imported { color: red }',
        'package.json': PACKAGE,
        'tsconfig.json': TSCONFIG,
    })
    broken = Bun.spawn(['bun', BIN, 'dev', '--root', dir, '--port', '0'], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    brokenBase = await addressOf(broken)
}, 30_000)

afterAll(() => {
    broken?.kill()
})

// THE REVERT: throw on `built.success === false` in `bundleInMemory` — the way `abide build` does
// — and the command dies at boot, so this test has no server to ask.
// THE REVERT: drop `keepServing()` from the worker; bun ends it, 38.41 replaces it, and the count
// reads 1 where it should read `count + 1`.
//
// SEQUENCED BY WHICH POLICY SPOKE, not by the rejection being printed. bun's own default prints the
// rejection and ends the process a turn or more LATER, so a request sent on the printed line is
// still answered by the worker that is about to die — sequenced that way the revert read
// `count + 1` too. Each arm says something only it says: the lifecycle log is `keepServing`'s
// report (37.8), and the listener's restart line comes after bun's exit.
const REPORTED = /abide:lifecycle[^\n]*nobody awaited this/
const RESTARTED = 'the app exited, so it was restarted'
test('a rejection nobody awaited neither ends the app nor loses its state — 37.8, 37.9', async () => {
    const before = await received(await Bun.fetch(`${base}/served`))
    const count = Number(/<main id="served">(\d+)/.exec(before)?.[1])
    const restartsBefore = serverSaid.split(RESTARTED).length
    expect(await received(await Bun.fetch(`${base}/orphan`))).toContain(
        'orphaned',
    )
    await waitUntil(
        async () => serverSaid,
        (said) =>
            REPORTED.test(said) ||
            said.split(RESTARTED).length > restartsBefore,
        'the rejection reported, or the app restarted',
    )
    expect(await received(await Bun.fetch(`${base}/served`))).toContain(
        `<main id="served">${count + 1}</main>`,
    )
    expect(serverSaid).toMatch(REPORTED)
}, 30_000)

// THE REVERT: drop the worker's `close` listener in `serveDev`; the request is never answered and
// every one after it hangs.
test('an app that exits is restarted, and the request it held is answered — 38.41', async () => {
    // The head goes out before setup runs, so what the exit leaves is a body that ends rather than
    // one that never does.
    await received(await Bun.fetch(`${base}/exit`))
    expect(
        await waitFor(`${base}/`, (body) => body.includes('Home')),
    ).toContain('<h1>Home</h1>')
}, 30_000)

test('a client build that fails does not stop the server — 38.17', async () => {
    const response = await Bun.fetch(`${brokenBase}/`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<h1>Home</h1>')
    // NO TAG FOR A BUNDLE THAT IS NOT THERE. A `<script>` at a 404 is a console error standing in
    // for the build error the terminal carries.
    expect(html).not.toContain('/__abide/client/entry.js')
    // And the reload client is still there, which is 38.17's other half: the next save is what
    // fixes this, and a document with no reload client cannot receive it.
    expect(html).toContain('/__abide/dev/client.js')
})

// A THIRD APP, AND IT EARNS THE THIRD BOOT: the collision has to be there at BOOT, because what
// is being asked is whether the DEV lane refuses it at all — a reload recovering from one would
// be a different clause.
let colliding: Bun.Subprocess | undefined
let collidingBase = ''

beforeAll(async () => {
    const dir = temporaryModule({
        'index.abide': HOME,
        'seam/index.abide': SEAM_PAGE,
        'lib/greeting.ts':
            "export function greeting(): string {\n    return 'from the shared seam'\n}\n",
        'about/index.abide': '<main id="about">About</main>',
        // The file that shadows the page. `abide build` has refused this since the clause was
        // written; `abide dev` served it.
        'public/about': 'the file that shadows the page',
        'package.json': PACKAGE,
        'tsconfig.json': TSCONFIG,
    })
    colliding = Bun.spawn(['bun', BIN, 'dev', '--root', dir, '--port', '0'], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    collidingBase = await addressOf(colliding)
}, 30_000)

afterAll(() => {
    colliding?.kill()
})

// 36.13 IN THE DEV LANE. The clause was enforced inside `abide build`'s copy loop, so `abide dev`
// — which has no build step — checked nothing, while `answerRequest` answers a public file ahead
// of any route on the stated ground that a collision cannot exist at run time. 30.8 is what that
// breaks: the same address resolved to the PAGE under `abide start` and to the FILE under
// `abide dev`.
//
// THE REVERT: drop the `refuseAddressCollision` call in `compileApp`'s `emitApp` and this boots clean,
// after which `/about` answers 200 with `the file that shadows the page` — the page unreachable,
// in one lane only, and nothing said so.
test('a public file claiming a page address is refused by dev too — 36.13', async () => {
    const failed = await (await Bun.fetch(`${collidingBase}/about`)).text()
    // BOTH, which is the clause — and the same two halves `abide build` names.
    expect(failed).toContain('public/about')
    expect(failed).toContain('/about')
    expect(failed).toContain('36.13')
    // The address is NOT the file, which is the whole of what went wrong.
    expect(failed).not.toContain('the file that shadows the page')
}, 30_000)

// 3000 TAKEN, by this file where nothing else has it — a machine running something there already
// is the case the clauses are for, so either way the port is held while the command boots.
function holdPort(port: number): (() => void) | undefined {
    try {
        const held = Bun.listen({ hostname: '::', port, socket: { data() {} } })
        return () => held.stop(true)
    } catch {
        return undefined
    }
}

function withoutPort(): Record<string, string | undefined> {
    const env = { ...process.env }
    delete env.PORT
    return env
}

// THE REVERT: listen once on `options.port` as before; the command dies on EADDRINUSE and prints no
// address.
test('a dev server given no port takes the next free one from 3000 — 38.63', async () => {
    const release = holdPort(3000)
    const scanning = Bun.spawn(['bun', BIN, 'dev', '--root', app], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: withoutPort(),
    })
    try {
        const port = Number(new URL(await addressOf(scanning)).port)
        expect(port).toBeGreaterThan(3000)
        expect(port).toBeLessThanOrEqual(3099)
    } finally {
        scanning.kill()
        release?.()
    }
}, 30_000)

// THE REVERT: drop the guard ahead of the scan; the command moves off the port it was given and
// prints an address.
test('a dev server given a taken port does not move off it — 38.64', async () => {
    const release = holdPort(3000)
    const pinned = Bun.spawn(['bun', BIN, 'dev', '--root', app], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...withoutPort(), PORT: '3000' },
    })
    try {
        expect(await pinned.exited).not.toBe(0)
        expect(await new Response(pinned.stderr).text()).toContain('EADDRINUSE')
    } finally {
        pinned.kill()
        release?.()
    }
}, 30_000)
