// 38.4 — `abide dev`, end to end: the command is spawned, a browser's worth of requests are made
// against it, and the project is EDITED underneath it. The edit is the whole point — every other
// arm of this file would pass against `abide start` with a watcher bolted on, and what the clause
// asks for is that the app a reader gets after a save is the app the source now says.
//
// THE SERVER IS A SUBPROCESS for `serve.test.ts`'s reasons: `bunfig.toml` preloads happy-dom over
// every test file, `Bun.serve` refuses a `Response` it did not define, and the command a host
// runs is the more honest arm anyway. `Bun.fetch` for the same clobbering on the other side.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

const SHELL = `<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>`

const HOME = `<script>
import { reactive } from 'abide'
import '#ui/home.css'

let count = reactive(0)
</script>

<head><title>Home</title></head>
<main id="home"><h1>Home</h1><p id="n">{count}</p></main>`

const PACKAGE = JSON.stringify({
    name: 'dev-fixture',
    type: 'module',
    imports: { '#ui/*': './ui/*' },
})

const TSCONFIG = JSON.stringify({
    compilerOptions: {
        strict: true,
        target: 'esnext',
        module: 'preserve',
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        types: [],
    },
    include: ['ui'],
})

let server: Bun.Subprocess | undefined
let base = ''
let app = ''

beforeAll(async () => {
    app = temporaryModule({
        'ui/app.html': SHELL,
        'ui/pages/page.abide': HOME,
        'ui/home.css': '.fixture-sheet-was-imported { color: red }',
        // 38.20 — IN THE SOURCE TREE AND NOWHERE ELSE. Nothing copies this anywhere, because
        // nothing builds: an address answering it is the clause and a stale copy cannot pass it.
        'ui/public/robots.txt': 'User-agent: *\nAllow: /\n',
        'package.json': PACKAGE,
        'tsconfig.json': TSCONFIG,
    })
    server = Bun.spawn(['bun', BIN, 'dev', '--root', app, '--port', '0'], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    base = await addressOf(server)
}, 30_000)

afterAll(() => {
    server?.kill()
    removeTemporaryModules()
})

// The origin the command printed. Read rather than assumed — and a boot that fails says so here
// rather than leaving every test below to time out against a socket nothing is on.
async function addressOf(child: Bun.Subprocess): Promise<string> {
    let seen = ''
    for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
        seen += new TextDecoder().decode(chunk)
        const found = /http:\/\/[^\s]+/.exec(seen)
        if (found) return new URL(found[0]).origin
    }
    throw new Error(`abide dev printed no address: ${seen}`)
}

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
        async () => await (await Bun.fetch(address)).text(),
        holds,
        address,
    )
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
// module the page's markup was never in.
async function pageChunk(): Promise<string> {
    const entry = await (
        await Bun.fetch(`${base}/__abide/client/entry.js`)
    ).text()
    const found = /"\.\/(page\.client-[^"]+\.js)"/.exec(entry)
    if (found === null) return entry
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

// 38.17 — IN MEMORY, AND NAMED BY ITS SOURCE. `entry.js` rather than a content hash is what makes
// a stack trace name the module the author wrote, and it is the one place dev parts company with
// 38.5's hashed chunks on purpose.
test('the client is built into memory and answered under the bundle address — 38.17, 38.21', async () => {
    const entry = await Bun.fetch(`${base}/__abide/client/entry.js`)
    expect(entry.status).toBe(200)
    const text = await entry.text()
    expect(text).toContain('startRouter')
    // UNMINIFIED, asserted as a name a minifier takes: the clause is about what an author can
    // read in a debugger, and a byte count would pass on a whitespace difference.
    expect(text).toContain('hydrate')

    const sheet = await Bun.fetch(`${base}/__abide/client/entry.css`)
    expect(sheet.status).toBe(200)
    expect(await sheet.text()).toContain('.fixture-sheet-was-imported')
})

// THE REVERT: hand `Bun.build` an `outdir` and this reports the tree it left behind. Nothing a
// reader sees moves — the same bundle is served either way — which is why it is asserted.
test('the command writes nothing to disk — 38.17', async () => {
    const before = tree()
    await Bun.fetch(`${base}/`)
    await Bun.fetch(`${base}/__abide/client/entry.js`)
    expect(tree()).toEqual(before)
    expect(before.some((name) => name.startsWith('.abide/'))).toBe(false)
    expect(before.some((name) => name.includes('__abide'))).toBe(false)
})

test('a file under public is answered out of the source tree — 38.20', async () => {
    const robots = await Bun.fetch(`${base}/robots.txt`)
    expect(robots.status).toBe(200)
    expect(await robots.text()).toBe('User-agent: *\nAllow: /\n')
})

// 38.18 — SERVED BY THE DEV WORKER, which is what its address says: it is not in the bundle, it
// is not in the app, and it reaches a document whose bundle failed to build.
test('the document loads a reload client the worker serves — 38.18', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain(
        '<script type="module" src="/__abide/dev/client.js"></script>',
    )
    const client = await Bun.fetch(`${base}/__abide/dev/client.js`)
    expect(client.status).toBe(200)
    expect(await client.text()).toContain('WebSocket')
})

// THE CLAUSE ITSELF. Everything above holds for a server that read the project once.
test('a save reaches the next request — 38.4, 38.16', async () => {
    await save(
        'ui/pages/page.abide',
        HOME.replace('<h1>Home</h1>', '<h1>Saved</h1>'),
    )
    expect(
        await waitFor(`${base}/`, (body) => body.includes('Saved')),
    ).toContain('<h1>Saved</h1>')

    // AND THE BUNDLE IS THE NEW ONE TOO. The document and the bundle are built by the same
    // worker, so a reload that served new markup against a stale bundle is a hydration mismatch
    // on every page — and the markup arm alone cannot see it.
    await waitUntil(pageChunk, (body) => body.includes('Saved'), 'the bundle')
    await save('ui/pages/page.abide', HOME)
    await waitFor(`${base}/`, (body) => body.includes('Home'))
}, 30_000)

// 38.16 — THE FORCE-CLOSE, which is the whole reload protocol: nothing is sent over this socket
// and its LIFE is the message. THE REVERT: drop the `terminate` loop from `replace` and the
// socket stays open across the save, so a browser waits for a reload that never comes.
test('a live socket is force-closed when the worker is replaced — 38.16', async () => {
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
    await save('ui/app.html', SHELL)
    await closed
}, 30_000)

// 38.4 — KEEP THE APP UP. A source that does not compile is the common case in a dev loop, and a
// command that exits on one is a command an author restarts by hand every time they typo.
test('a source that does not compile keeps the server up — 38.4', async () => {
    await save('ui/pages/page.abide', '<script>\nlet x = (\n</script>\n<main/>')
    const failed = await waitFor(`${base}/`, (body) =>
        body.includes('abide dev'),
    )
    expect(failed).toContain('abide dev')

    await save('ui/pages/page.abide', HOME)
    expect(
        await waitFor(`${base}/`, (body) => body.includes('Home')),
    ).toContain('<h1>Home</h1>')
}, 30_000)

// A SECOND APP, AND IT EARNS THE SECOND BOOT: a client build that fails cannot be provoked in an
// app whose pages all resolve, and the failure has to be there at BOOT for the clause to be about
// the server staying up rather than about a reload recovering.
let broken: Bun.Subprocess | undefined
let brokenBase = ''

beforeAll(async () => {
    const dir = temporaryModule({
        'ui/app.html': SHELL,
        'ui/pages/page.abide': HOME,
        // THE BROWSER GRAPH ALONE. A route's module is imported lazily on the server, so this
        // page is never loaded by the arm below — and the bundler follows every dynamic import
        // in the table, so the bundle it builds is the thing that fails.
        'ui/pages/broken/page.abide': `<script>
import '#ui/nothing-is-here.css'
</script>

<main id="broken"/>`,
        'ui/home.css': '.fixture-sheet-was-imported { color: red }',
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
test('a client build that fails does not stop the server — 38.18', async () => {
    const response = await Bun.fetch(`${brokenBase}/`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<h1>Home</h1>')
    // NO TAG FOR A BUNDLE THAT IS NOT THERE. A `<script>` at a 404 is a console error standing in
    // for the build error the terminal carries.
    expect(html).not.toContain('/__abide/client/entry.js')
    // And the reload client is still there, which is 38.18's other half: the next save is what
    // fixes this, and a document with no reload client cannot receive it.
    expect(html).toContain('/__abide/dev/client.js')
})
