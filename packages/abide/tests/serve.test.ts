// 38.6 — `abide start`, end to end and in one process: the CLI builds an app, `serveBuild` answers
// it, and what comes back over http is the document a browser would get.
//
// THE PARAM PAGE IS THE POINT OF THE FIXTURE. A page with no props renders the same whether its
// props are accessors or a plain record, so an app of two static pages gates the plumbing and none
// of the contract. `/invoices/42` is the one address where 33.4 is load-bearing on both sides.

// THE SERVER IS A SUBPROCESS, AND IT HAS TO BE. `bunfig.toml` preloads happy-dom for every test
// file, which replaces the global `Response` — and `Bun.serve` refuses one it did not define, so
// `serveBuild` called in here cannot answer a single request. Spawning `abide start` is both the
// way around that and the more honest arm: what is gated is the command a host runs.
//
// `Bun.fetch` for the other half of the same clobbering: the global `fetch` in a test file is the
// window's, and happy-dom's http client rejects these responses with "Duplicate Content-Length".

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

const SHELL = `<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>`

// 34.6 and 38.24: the stylesheet is a dependency of the page, and the document links what the
// build made of it. The page never names an address — that is the whole of the clause.
//
// `#ui/…` AND NOT `./home.css`, WHICH IS THE SPELLING REGISTRY DOCUMENTS. A relative specifier is
// left exactly as written (`componentImports`) and the emitted module lives in the build tree, so
// `./home.css` resolves beside the OUTPUT and misses the source — for a `.ts` helper as much as
// for a stylesheet. An import-map specifier resolves the same from either tree, which is why the
// dogfood app uses one too.
const HOME = `<script>
import { reactive } from 'abide'
import '#ui/home.css'

let count = reactive(0)
</script>

<head><title>Home</title></head>
<main id="home"><h1>Home</h1><p id="n">{count}</p></main>`

// 33.4 through a page. The address supplies `id` and the page reads it, which is a prop read and
// nothing else — so it lowers to an accessor call and only an accessor answers it.
const INVOICE = `<script>
import { props } from 'abide'

const { params } = props<{ params: { id: string } }>()
</script>

<head><title>Invoice</title></head>
<main id="invoice"><h1>Invoice {params.id}</h1></main>`

let server: Bun.Subprocess | undefined
let base = ''

beforeAll(async () => {
    const app = temporaryModule({
        'ui/app.html': SHELL,
        'ui/pages/page.abide': HOME,
        // A SELECTOR RATHER THAN A DECLARATION, as the thing asserted on: the bundler normalises
        // a colour (`rgb(1, 2, 3)` came back `#010203`) and a class name it cannot touch.
        'ui/home.css': '.fixture-sheet-was-imported { color: red }',
        'package.json': JSON.stringify({
            name: 'serve-fixture',
            type: 'module',
            imports: { '#ui/*': './ui/*' },
        }),
        'ui/pages/invoices/[id]/page.abide': INVOICE,
        // 36.11 — TWO DEPTHS, because "its path below that directory" is the clause and a flat
        // directory cannot tell a path from a name.
        'ui/public/robots.txt': 'User-agent: *\nAllow: /\n',
        'ui/public/img/dot.svg':
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
        // THE APP'S OWN, rather than whatever the walk up from here finds. The compiler reads
        // props off the checker (19.10), so a fixture with no project of its own is one where
        // `params` never lowers and this file passes for the wrong reason.
        'tsconfig.json': JSON.stringify({
            compilerOptions: {
                strict: true,
                target: 'esnext',
                module: 'preserve',
                moduleResolution: 'bundler',
                allowImportingTsExtensions: true,
                types: [],
            },
            include: ['ui'],
        }),
    })

    const built = Bun.spawnSync([
        'bun',
        BIN,
        'build',
        '--root',
        app,
        '--out',
        `${app}/.abide`,
    ])
    if (built.exitCode !== 0)
        throw new Error(`abide build failed: ${built.stderr.toString()}`)

    // `--port 0` and the address read back off stdout, rather than a number picked here: this
    // file runs under `--parallel` beside every other one, and a fixed port is the one way a
    // suite that passes alone fails in a batch.
    server = Bun.spawn(
        [
            'bun',
            BIN,
            'start',
            '--root',
            app,
            '--out',
            `${app}/.abide`,
            '--port',
            '0',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    base = await addressOf(server)
}, 30_000)

afterAll(() => {
    server?.kill()
    removeTemporaryModules()
})

// The origin `abide start` printed. Read rather than assumed — and a boot that fails says so here
// rather than leaving every test below to time out against a socket nothing is on.
async function addressOf(child: Bun.Subprocess): Promise<string> {
    let seen = ''
    for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
        seen += new TextDecoder().decode(chunk)
        const found = /http:\/\/[^\s]+/.exec(seen)
        if (found) return new URL(found[0]).origin
    }
    throw new Error(
        `abide start printed no address: ${seen}${await new Response(child.stderr as ReadableStream<Uint8Array>).text()}`,
    )
}

test('an address a page matches is painted into the shell — 38.6', async () => {
    const response = await Bun.fetch(`${base}/`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()

    expect(html).toContain('<main id="home"><h1>Home</h1>')
    // 39.1 — the page's head reached the document's, ahead of the body.
    expect(html).toContain('<title>Home</title>')
    expect(html.indexOf('<title>')).toBeLessThan(html.indexOf('<main'))
    // The shell is the app's, not a document the server invented.
    expect(html).toContain('<meta charset="utf-8">')
})

// THE REVERT: hand the page `{ params: found.params }` rather than `{ params: () => … }` in
// `serveBuild` and this reports `params is not a function` instead of the id — which is the same
// break `Router.paramsProp` carries on the client side of the same contract.
test('a param in the address reaches the page as a prop — 33.4, 38.6', async () => {
    const response = await Bun.fetch(`${base}/invoices/42`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<h1>Invoice 42</h1>')
})

// 38.23. Nothing hydrates without it, and the page still looks right — so this is asserted rather
// than left to a browser noticing.
test('the document loads the client entry — 38.23', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain(
        '<script type="module" src="/__abide/client/entry.js"></script>',
    )
    // AND THE ADDRESS ANSWERS. The tag naming a 404 is the failure this pair exists to split:
    // the document is identical either way.
    const entry = await Bun.fetch(`${base}/__abide/client/entry.js`)
    expect(entry.status).toBe(200)
    expect(await entry.text()).toContain('startRouter')
})

test('the script tag lands in the head, ahead of the body — 38.23', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html.indexOf('<script type="module"')).toBeLessThan(
        html.indexOf('<body>'),
    )
})

test('an address no route matches is 404 — 38.22', async () => {
    expect((await Bun.fetch(`${base}/nope`)).status).toBe(404)
    // A file the build never produced, asked for under the client address.
    expect((await Bun.fetch(`${base}/__abide/client/nope.js`)).status).toBe(404)
})

test('the document links the stylesheet the build bundled — 34.6, 38.24', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain(
        '<link rel="stylesheet" href="/__abide/client/entry.css">',
    )
    // AHEAD OF THE SCRIPT, so the document does not paint once unstyled.
    expect(html.indexOf('rel="stylesheet"')).toBeLessThan(
        html.indexOf('<script type="module"'),
    )

    const sheet = await Bun.fetch(`${base}/__abide/client/entry.css`)
    expect(sheet.status).toBe(200)
    // THE PAGE'S OWN RULE, which is what says the import was followed rather than a file being
    // emitted with the right name.
    expect(await sheet.text()).toContain('.fixture-sheet-was-imported')
})

test('a public file is answered at its path below the directory — 36.11, 36.12', async () => {
    const flat = await Bun.fetch(`${base}/robots.txt`)
    expect(flat.status).toBe(200)
    expect(await flat.text()).toBe('User-agent: *\nAllow: /\n')

    // A PATH, NOT A NAME. Flattened to the basename this still passes on `robots.txt` alone.
    const nested = await Bun.fetch(`${base}/img/dot.svg`)
    expect(nested.status).toBe(200)
    expect(await nested.text()).toContain('<svg')
})

test('a public file carries a content-type off its extension — 36.14', async () => {
    expect(
        (await Bun.fetch(`${base}/robots.txt`)).headers.get('content-type'),
    ).toContain('text/plain')
    expect(
        (await Bun.fetch(`${base}/img/dot.svg`)).headers.get('content-type'),
    ).toContain('image/svg+xml')
})

// THE REVERT: answer the public branch with a bare `new Response(Bun.file(…))` and all three of
// these report — no etag, no `cache-control`, and a conditional request answered 200 with the
// whole body. Nothing about what a reader SEES moves, which is the whole reason it is asserted.
test('a public file revalidates against an etag off its bytes — 21.12, 21.13, 21.14', async () => {
    const first = await Bun.fetch(`${base}/robots.txt`)
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    expect(first.headers.get('cache-control')).toBe(
        'public, max-age=0, must-revalidate',
    )

    const again = await Bun.fetch(`${base}/robots.txt`, {
        headers: { 'if-none-match': etag as string },
    })
    expect(again.status).toBe(304)

    // AND A STALE ONE IS NOT 304. Answering every conditional request 304 passes the line above
    // and serves a reader the bytes they already had, for ever.
    const stale = await Bun.fetch(`${base}/robots.txt`, {
        headers: { 'if-none-match': '"not-the-etag"' },
    })
    expect(stale.status).toBe(200)
})

// A SECOND APP, AND IT EARNS THE SECOND BOOT. Everything above is asserted against an app that
// HAS a stylesheet and HAS a public directory, and the presence arm cannot tell either mechanism
// from one that is unconditional — writing the `<link>` always passes every test above, and so
// does a `publicFiles` that never handles an absent directory. This app has neither, which is
// also the shape of every app before its author adds one.
let bare: Bun.Subprocess | undefined
let bareBase = ''

beforeAll(async () => {
    const app = temporaryModule({
        'ui/app.html': SHELL,
        'ui/pages/page.abide':
            '<head><title>Bare</title></head>\n<main id="bare">Bare</main>',
        'tsconfig.json': JSON.stringify({
            compilerOptions: { strict: true, target: 'esnext', types: [] },
            include: ['ui'],
        }),
    })
    const built = Bun.spawnSync([
        'bun',
        BIN,
        'build',
        '--root',
        app,
        '--out',
        `${app}/.abide`,
    ])
    if (built.exitCode !== 0)
        throw new Error(`abide build failed: ${built.stderr.toString()}`)

    bare = Bun.spawn(
        [
            'bun',
            BIN,
            'start',
            '--root',
            app,
            '--out',
            `${app}/.abide`,
            '--port',
            '0',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    bareBase = await addressOf(bare)
}, 30_000)

afterAll(() => {
    bare?.kill()
})

// THE REVERT: write the `<link>` unconditionally in `withClientEntry` and this reports a document
// fetching a missing stylesheet on every load — and looking exactly right doing it.
test('an app that imports no stylesheet links none — 38.24', async () => {
    const html = await (await Bun.fetch(`${bareBase}/`)).text()
    expect(html).toContain('<main id="bare">Bare</main>')
    expect(html).not.toContain('rel="stylesheet"')
    expect(
        (await Bun.fetch(`${bareBase}/__abide/client/entry.css`)).status,
    ).toBe(404)
})

// THE REVERT: scan the public directory without testing for it, and `abide start` throws at boot
// rather than at a request — so this app serves nothing at all and the failure is the address
// never being printed.
test('an app with no public directory still boots and serves — 38.19', async () => {
    expect((await Bun.fetch(`${bareBase}/`)).status).toBe(200)
    expect((await Bun.fetch(`${bareBase}/robots.txt`)).status).toBe(404)
})

// 36.13 — A BUILD ERROR, and the build is the only place it can be seen: a public file and a page
// route are two walks of two different trees, and from inside either one the collision is
// invisible. Left to run time it is a silent preference, and which one wins is whatever the
// server happened to check first.
//
// THE REVERT: drop the `addresses.has` test in `copyPublic` and the build succeeds, after which
// `/about` is the FILE — the page is unreachable and nothing said so.
test('a public file claiming a page address is a build error naming both — 36.13', () => {
    const app = temporaryModule({
        'ui/pages/about/page.abide': '<main>About</main>',
        'ui/public/about': 'the file that shadows the page',
    })
    const built = Bun.spawnSync([
        'bun',
        BIN,
        'build',
        '--root',
        app,
        '--out',
        `${app}/.abide`,
    ])

    expect(built.exitCode).not.toBe(0)
    const said = built.stderr.toString()
    // BOTH, which is the clause. Naming one leaves the reader to find the other.
    expect(said).toContain('ui/public/about')
    expect(said).toContain('/about')
    expect(said).toContain('36.13')
}, 30_000)
