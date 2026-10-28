// 38.6 — `abide start`, end to end and in one process: the CLI builds an app, `abide start` answers
// it, and what comes back over http is the document a browser would get.
//
// THE PARAM PAGE IS THE POINT OF THE FIXTURE. A page with no props renders the same whether its
// props are accessors or a plain record, so an app of two static pages gates the plumbing and none
// of the contract. `/invoices/42` is the one address where 33.4 is load-bearing on both sides.

// THE SERVER IS A SUBPROCESS, AND IT HAS TO BE. `bunfig.toml` preloads happy-dom for every test
// file, which replaces the global `Response` — and `Bun.serve` refuses one it did not define, so
// `serveApp` called in here cannot answer a single request. Spawning `abide start` is both the
// way around that and the more honest arm: what is gated is the command a host runs.
//
// `Bun.fetch` for the other half of the same clobbering: the global `fetch` in a test file is the
// window's, and happy-dom's http client rejects these responses with "Duplicate Content-Length".

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { brotliDecompressSync } from 'node:zlib' // bun decompresses gzip and zstd of its own, and no brotli
import { buildApp, serveApp, startApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

// 34.6 and 38.23: the stylesheet is a dependency of the page, and the document links what the
// build made of it. The page never names an address — that is the whole of the clause.
//
// 34.14 — RELATIVE, THE SPELLING REGISTRY DOCUMENTS, for a stylesheet and a `.ts` helper alike,
// resolved from the `.abide` that wrote it — the compiled module is served at the file's own path.
const HOME = `<script>
import { reactive } from '@abide/abide'
import Badge from '#src/lib/components/Badge.abide'
import './lib/home.css'
import { greeting } from './lib/greeting.ts'

let count = reactive(0)
</script>

<head><title>Home</title></head>
<main id="home"><h1>Home</h1><p id="n">{count}</p><p id="greeting">{greeting}</p><Badge label="live"/></main>`

// 32.17 THROUGH A BUILD, which is the one arm that can say a component import RESOLVES. Left as
// written with its extension swapped, the specifier the emitted page carries is
// `#src/lib/components/Badge.ts` — a file that exists in the output tree and nowhere in the source tree
// the import map points at. `componentGraph` resolves it to a path inside the build; without that
// the bundle cannot resolve the client half and the build fails.
const BADGE = `<script>
import { props } from '@abide/abide'

const { label } = props<{ label: string }>()
</script>

<span id="badge">{label}</span>`

// 33.4 through a page. The address supplies `id` and the page reads it, which is a prop read and
// nothing else — so it lowers to an accessor call and only an accessor answers it.
const INVOICE = `<script>
import { props } from '@abide/abide'

const { params } = props<{ params: { id: string } }>()
</script>

<head><title>Invoice</title></head>
<main id="invoice"><h1>Invoice {params.id}</h1></main>`

// 41.1 — A PAGE WHOSE IMPORT TAKES A WHILE, and the only way a fixture can make one: a component
// script refuses a top-level `await`, and a module it imports does not. The wait is the import's,
// which is exactly what the first request for a page after boot pays — before any of it is sent.
const SLOW_MS = 400

const SLOW = `<script>
import '#src/lib/slow.ts'
</script>

<main id="slow"><h1>Slow</h1></main>`

// 41.1 — a page that fails as it is imported, before anything has gone out.
const BROKEN = `<script>
import '#src/lib/broken.ts'
</script>

<main id="broken"><h1>Broken</h1></main>`

const LIST_ROWS = `import { GET } from '@abide/abide/server'

export default GET(() =>
    Array.from({ length: 120 }, (_, at) => ({ id: \`row_\${at}\`, status: at % 2 === 0 ? 'open' : 'paid' })),
)
`

const ONE_ROW = `import { GET } from '@abide/abide/server'

export default GET(() => ({ id: 'row_0', status: 'open' }))
`

let stop: (() => void) | undefined
let base = ''

beforeAll(async () => {
    const app = temporaryModule({
        'index.abide': HOME,
        'lib/greeting.ts': `export const greeting = 'beside the page'\n`,
        'lib/components/Badge.abide': BADGE,
        // A SELECTOR RATHER THAN A DECLARATION, as the thing asserted on: the bundler normalizes
        // a color (`rgb(1, 2, 3)` came back `#010203`) and a class name it cannot touch.
        // 36.15 — AND ONE URL NAMING A PUBLIC FILE, which is the address below rather than a path
        // on this disk: read as a path, it fails the build this whole file is served from.
        'lib/home.css':
            ".fixture-sheet-was-imported { color: red }\n.fixture-uses-public { background: url('/img/dot.svg') }",
        'package.json': JSON.stringify({
            name: 'serve-fixture',
            type: 'module',
            imports: { '#src/*': './*' },
        }),
        'invoices/[id]/index.abide': INVOICE,
        'slow/index.abide': SLOW,
        'lib/slow.ts': `await new Promise((settle) => setTimeout(settle, ${SLOW_MS}))\nexport {}\n`,
        'broken/index.abide': BROKEN,
        // 38.29, 38.68 — one answer over the floor and one under it.
        'ledger/listRows.ts': LIST_ROWS,
        'ledger/oneRow.ts': ONE_ROW,
        // ON THE SERVER ONLY, so the build still bundles it: the browser never evaluates it here.
        'lib/broken.ts': `if (typeof window === 'undefined') throw new Error('broken on purpose')\nexport {}\n`,
        // 36.11 — TWO DEPTHS, because "its path below that directory" is the clause and a flat
        // directory cannot tell a path from a name.
        'public/robots.txt': 'User-agent: *\nAllow: /\n',
        'public/notes.md': '# notes\n',
        // 36.11 — A NAME THE URL PARSER ESCAPES, asked for as `/my%20ph%C3%B6to.txt`.
        'public/my phöto.txt': 'escaped\n',
        'public/img/dot.svg':
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
        // THE APP'S OWN, rather than whatever the walk up from here finds. The compiler reads
        // props off the checker (19.9), so a fixture with no project of its own is one where
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
            include: ['**/*'],
        }),
    })

    const built = await buildApp(app)
    if (built.exitCode !== 0)
        throw new Error(`abide build failed: ${built.stderr}`)

        // `--port 0` and the address read back off stdout, rather than a number picked here: this
        // file runs under `--parallel` beside every other one, and a fixed port is the one way a
        // suite that passes alone fails in a batch.
    ;({ base, stop } = await startApp(app))
}, 30_000)

afterAll(() => {
    stop?.()
    removeTemporaryModules()
})

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
// `answerRequest` and this reports `params is not a function` instead of the id — which is the same
// break `Router.ts`'s `routeProps` carries on the client side of the same contract.
// THE REVERT: hand the emitters no `componentGraph` imports in `compileApp` and the build this
// file serves fails before any address answers — `Could not resolve: "#src/lib/components/Badge.client.ts"`,
// the module the page imports being in the source tree, where the compiler wrote nothing.
// THE REVERT: leave `splitImports` to rewrite `.abide` specifiers alone and the build this file
// serves fails before any address answers — `Could not resolve: "../lib/greeting.ts"`, beside the output.
test('a relative import in a page resolves from the page — 34.14', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain('<p id="greeting">beside the page</p>')
})

test('a page invoking a component is painted with it — 32.17, 38.6', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain('<span id="badge">live</span>')
})

test('a param in the address reaches the page as a prop — 33.4, 38.6', async () => {
    const response = await Bun.fetch(`${base}/invoices/42`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<h1>Invoice 42</h1>')
})

// The entry's file name, off the document's own script tag — a build hashes it (38.5), so it is
// read where a browser reads it rather than spelled out here.
async function entryOf(): Promise<string> {
    const html = await (await Bun.fetch(`${base}/`)).text()
    const found =
        /<script type="module" src="\/__abide\/client\/([^"]+)"><\/script>/.exec(
            html,
        )
    if (found === null) throw new Error(`the document loads no entry: ${html}`)
    return found[1] as string
}

// 38.22. Nothing hydrates without it, and the page still looks right — so this is asserted rather
// than left to a browser noticing.
test('the document loads the client entry — 38.22', async () => {
    const entry = await entryOf()
    // AND THE ADDRESS ANSWERS. The tag naming a 404 is the failure this pair exists to split:
    // the document is identical either way.
    const response = await Bun.fetch(`${base}/__abide/client/${entry}`)
    expect(response.status).toBe(200)
    // THE ROUTE TABLE, as a string a minifier leaves alone.
    expect(await response.text()).toContain('/invoices/[id]')
})

// 38.5 — HASHED AND MINIFIED. The name is the half that is correctness: every file under the
// client address is served for a year, so an entry under a fixed name is the old app for every
// returning reader after a deploy, pointing at chunks the new build deleted.
// THE REVERT: drop `naming` from `clientBundle` and the entry is `entry.js`; drop `minify` and the
// comment the bundler heads each module with — its source path — is still in it.
test('the entry is content-hashed and minified — 38.5', async () => {
    const entry = await entryOf()
    expect(entry).toMatch(/^entry-[a-z0-9]+\.js$/)
    const text = await (
        await Bun.fetch(`${base}/__abide/client/${entry}`)
    ).text()
    expect(/^\/\/ .*listenForRoutes\.ts$/m.test(text)).toBe(false)
    // THE FIXED NAME IS GONE, not left beside the hashed one.
    expect((await Bun.fetch(`${base}/__abide/client/entry.js`)).status).toBe(
        404,
    )
})

test('the script tag lands in the head, ahead of the body — 38.22', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html.indexOf('<script type="module"')).toBeLessThan(
        html.indexOf('<body>'),
    )
})

// 38.28. Nothing a reader sees moves without it — the client asks for the same chunks itself, a
// round trip later — so the work is what is asserted: which addresses the document names.
// THE REVERTS: drop the loop over `chunks` from `clientTags` and this reports 0 preloads; follow
// `dynamic-import` edges in `manifestOf` too and every address preloads every page, 0 its own.
test('the document preloads the static closure of its own route, and nothing else — 38.28', async () => {
    const preloadsAt = async (address: string): Promise<string[]> => {
        const html = await (await Bun.fetch(`${base}${address}`)).text()
        const head = html.slice(0, html.indexOf('<body>'))
        const found: string[] = []
        for (const match of head.matchAll(
            /<link rel="modulepreload" href="\/__abide\/client\/([^"]+)">/g,
        ))
            found.push(match[1] as string)
        return found
    }
    const home = await preloadsAt('/')
    expect(home.length).toBeGreaterThan(0)
    // THE ENTRY IS THE SCRIPT TAG'S, and a preload of it is a second request line for it.
    expect(home).not.toContain(await entryOf())
    // NOR THE STYLESHEET, which the bundler reports as a static import of the entry: fetched as a
    // module it is a MIME error in the console and a second request for bytes 38.23 linked.
    for (const chunk of home) expect(chunk.endsWith('.js')).toBe(true)

    // CLOSED: every chunk a preloaded chunk imports statically is preloaded too, so the browser
    // has nothing left to discover before the page can run. And ONE OF THEM IS THE PAGE's.
    const bodies = new Map<string, string>()
    for (const chunk of home) {
        const response = await Bun.fetch(`${base}/__abide/client/${chunk}`)
        expect(response.status).toBe(200)
        bodies.set(chunk, await response.text())
    }
    for (const body of bodies.values())
        for (const match of body.matchAll(/from\s*"\.\/([^"]+\.js)"/g))
            if (!(match[1] as string).startsWith('entry-'))
                expect(home).toContain(match[1] as string)
    expect(
        [...bodies.values()].some((body) => body.includes('id="home"')),
    ).toBe(true)

    // ANOTHER ADDRESS PRELOADS ITS OWN PAGE and not this one: a dynamic import is a destination,
    // and following those edges is the whole route table on every document.
    const invoice = await preloadsAt('/invoices/42')
    const homeOnly = home.filter((chunk) => !invoice.includes(chunk))
    const invoiceOnly = invoice.filter((chunk) => !home.includes(chunk))
    expect(homeOnly.length).toBe(1)
    expect(invoiceOnly.length).toBe(1)
})

// 41.1 — NOTHING OF A PAGE GOES OUT UNTIL IT IS BUILT, since the status goes with the first byte: the
// document arrives whole, after the import. 38.29 AS WELL: COMPRESSED, and a compressor that held its
// input to the end would still pass, so the body is asserted complete rather than early. THE REVERT:
// yield the shell's head before the component is asked; `modulepreload` arrives before SLOW_MS.
test('nothing of a page is on the wire before it is built — 41.1', async () => {
    const started = performance.now()
    const response = await Bun.fetch(`${base}/slow`, {
        headers: { 'accept-encoding': 'br' },
    })
    expect(response.headers.get('content-encoding')).toBe('br')
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let seen = ''
    let headAt = Number.POSITIVE_INFINITY
    for (
        let read = await reader.read();
        !read.done;
        read = await reader.read()
    ) {
        seen += decoder.decode(read.value, { stream: true })
        if (
            headAt === Number.POSITIVE_INFINITY &&
            seen.includes('modulepreload')
        )
            headAt = performance.now() - started
    }
    expect(headAt).toBeGreaterThanOrEqual(SLOW_MS)
    expect(seen).toContain('<main id="slow">')
})

// 41.1 — A PAGE THAT FAILS BEFORE IT IS BUILT is answered at the failure's status, which for a throw
// is the server's 500 (16.41), and this app has no error page to paint it. THE REVERT: construct the
// `Response` in `answerRequest` before pulling the first chunk; it answers 200 and the stream errors.
test('a page that fails before it is built answers at its status — 41.1', async () => {
    const response = await Bun.fetch(`${base}/broken`)
    expect(response.status).toBe(500)
    // AND THE SERVER IS STILL UP.
    expect((await Bun.fetch(`${base}/`)).status).toBe(200)
})

// 38.5 AND 38.29 — THE BUNDLE, PRECOMPRESSED AND NEGOTIATED. Read with `decompress: false`, since
// `Bun.fetch` otherwise sends `br` itself and hands back the decoded bytes, and every other test in
// this file would pass whether anything was compressed or not.
// THE REVERT: drop `precompress` from the build and the brotli arm reports no `content-encoding`.
test('a bundled file is served in the encoding the request takes, and identical once decoded — 38.5, 38.29', async () => {
    const address = `${base}/__abide/client/${await entryOf()}`
    const plain = await Bun.fetch(address, {
        headers: { 'accept-encoding': 'identity' },
    })
    expect(plain.headers.get('content-encoding')).toBeNull()
    expect(plain.headers.get('vary')).toBe('accept-encoding')
    const identity = new Uint8Array(await plain.arrayBuffer())

    const brotli = await Bun.fetch(address, {
        headers: { 'accept-encoding': 'gzip, br' },
        decompress: false,
    })
    expect(brotli.headers.get('content-encoding')).toBe('br')
    expect(brotli.headers.get('content-type')).toContain('javascript')
    const brotliBytes = new Uint8Array(await brotli.arrayBuffer())
    expect(brotliBytes.length).toBeLessThan(identity.length)
    expect(new Uint8Array(brotliDecompressSync(brotliBytes))).toEqual(identity)

    const gzip = await Bun.fetch(address, {
        headers: { 'accept-encoding': 'gzip' },
        decompress: false,
    })
    expect(gzip.headers.get('content-encoding')).toBe('gzip')
    expect(Bun.gunzipSync(new Uint8Array(await gzip.arrayBuffer()))).toEqual(
        identity,
    )

    // THE COPIES ARE NOT ADDRESSES OF THEIR OWN (38.20).
    expect((await Bun.fetch(`${address}.br`)).status).toBe(404)
})

// 38.29 — THE DOCUMENT, compressed per request since it is rendered per request.
test('the document is compressed in the encoding the request takes — 38.29', async () => {
    const plain = await Bun.fetch(`${base}/`, {
        headers: { 'accept-encoding': 'identity' },
    })
    expect(plain.headers.get('content-encoding')).toBeNull()
    expect(plain.headers.get('vary')).toBe('accept-encoding')
    const identity = await plain.text()

    for (const [encoding, decode] of [
        ['br', brotliDecompressSync],
        ['gzip', Bun.gunzipSync],
    ] as const) {
        const response = await Bun.fetch(`${base}/`, {
            headers: { 'accept-encoding': encoding },
            decompress: false,
        })
        expect(response.headers.get('content-encoding')).toBe(encoding)
        expect(response.headers.get('content-type')).toContain('text/html')
        const bytes = new Uint8Array(await response.arrayBuffer())
        expect(new TextDecoder().decode(decode(bytes))).toBe(identity)
    }
})

// 38.29, 38.68 — A JSON ANSWER IS COMPRESSED IN THE ENCODING THE REQUEST TAKES, AND ONLY FROM THE FLOOR
// UP, with `vary` named either way. THE REVERTS: answer `answerJson`'s text without negotiating, and
// the list reads no `content-encoding` for either; drop the floor, and the one row reads `br`.
test('a JSON answer from the floor up is compressed in the encoding asked, and under it is not — 38.29, 38.68', async () => {
    const ask = (name: string, encoding: string) =>
        Bun.fetch(`${base}/ledger/${name}`, {
            headers: { 'accept-encoding': encoding },
            decompress: false,
        })
    const plain = await ask('listRows', 'identity')
    expect(plain.headers.get('content-encoding')).toBeNull()
    const identity = await plain.text()
    expect(identity.length).toBeGreaterThan(1024)
    for (const [encoding, decode] of [
        ['br', brotliDecompressSync],
        ['gzip', Bun.gunzipSync],
    ] as const) {
        const response = await ask('listRows', encoding)
        expect(response.headers.get('content-encoding')).toBe(encoding)
        expect(response.headers.get('vary')).toContain('accept-encoding')
        const bytes = new Uint8Array(await response.arrayBuffer())
        expect(new TextDecoder().decode(decode(bytes))).toBe(identity)
    }
    const small = await ask('oneRow', 'gzip, deflate, br')
    expect(small.headers.get('content-encoding')).toBeNull()
    expect(small.headers.get('vary')).toContain('accept-encoding')
    expect(await small.json()).toEqual({ id: 'row_0', status: 'open' })
})

// 38.68, 20.9 — AN MCP READ IS MADE IN PROCESS WITH THE CALLER'S HEADERS, and the handler's answer is
// read there rather than sent on: a client asking for brotli still has the tool's JSON read whole,
// and only the reply is encoded. THE REVERT: keep `accept-encoding` in `callOf`; the list is read
// as brotli bytes, and the tool's text is not the rows.
test('an MCP read takes its handler answer uncompressed, whatever the client accepts — 38.68, 20.9', async () => {
    const answer = await Bun.fetch(`${base}/__abide/mcp`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'accept-encoding': 'br',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'get_ledger_listRows' },
        }),
        decompress: false,
    })
    expect(answer.headers.get('content-encoding')).toBe('br')
    const reply = JSON.parse(
        new TextDecoder().decode(
            brotliDecompressSync(new Uint8Array(await answer.arrayBuffer())),
        ),
    ) as { result?: { content: { text: string }[] } }
    expect(JSON.parse(reply.result?.content[0]?.text ?? 'null')).toHaveLength(
        120,
    )
})

test('an address no route matches is 404 — 38.21', async () => {
    expect((await Bun.fetch(`${base}/nope`)).status).toBe(404)
    // A file the build never produced, asked for under the client address.
    expect((await Bun.fetch(`${base}/__abide/client/nope.js`)).status).toBe(404)
})

test('the document links the stylesheet the build bundled — 34.6, 38.23', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    const linked =
        /<link rel="stylesheet" href="\/__abide\/client\/(entry-[a-z0-9]+\.css)">/.exec(
            html,
        )
    expect(linked).not.toBeNull()
    // AHEAD OF THE SCRIPT, so the document does not paint once unstyled.
    expect(html.indexOf('rel="stylesheet"')).toBeLessThan(
        html.indexOf('<script type="module"'),
    )

    const sheet = await Bun.fetch(
        `${base}/__abide/client/${(linked as RegExpExecArray)[1]}`,
    )
    expect(sheet.status).toBe(200)
    // THE PAGE'S OWN RULE, which is what says the import was followed rather than a file being
    // emitted with the right name.
    expect(await sheet.text()).toContain('.fixture-sheet-was-imported')
})

// 36.15. THE REVERT: drop `external` from `clientBundle` and the build fails on
// `Could not resolve: "/img/dot.svg"` — every test in this file with it.
//
// 16.10 — WRITTEN RELATIVE TO THE SHEET, so it is the public file's address below any mount; read
// the way the browser reads it, against the sheet's own address. `mount.test.ts` is the mount.
test('a stylesheet URL naming a public file is left as its address — 36.15', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    const linked = (
        /<link rel="stylesheet" href="([^"]+)">/.exec(html) as RegExpExecArray
    )[1]
    const sheet = await (await Bun.fetch(`${base}${linked}`)).text()
    const named = /url\(["']?([^"')]+)/.exec(sheet)?.[1] as string
    const resolved = new URL(named, `${base}${linked}`)
    expect(resolved.pathname).toBe('/img/dot.svg')
    // AND THE ADDRESS IS THE FILE.
    expect((await Bun.fetch(resolved)).status).toBe(200)
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

// 36.11 — A NAME THE ADDRESS ESCAPES IS STILL ITS PATH: the space and the `ö` arrive percent-encoded
// and the file is keyed by its name on disk. THE REVERT: look the file up by `url.pathname` as it
// came; the address falls through to the routes and is 404.
test('a public file whose name the address escapes is answered — 36.11', async () => {
    const escaped = await Bun.fetch(`${base}/my phöto.txt`)
    expect(new URL(escaped.url).pathname).toBe('/my%20ph%C3%B6to.txt')
    expect(escaped.status).toBe(200)
    expect(await escaped.text()).toBe('escaped\n')
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
        // 21.23 — the fixture is served built, where the worker is registered.
        'public, max-age=0, stale-while-revalidate=604800, stale-if-error=31536000',
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

// 21.14 — WEAK COMPARISON: the `W/` form a compressing proxy hands the browser, a list, and `*`. THE
// REVERT: compare `if-none-match` to the etag with `===`; all three answer 200 with the body.
test('a public file revalidates against a weak, listed or wildcard etag — 21.14', async () => {
    const etag = (await Bun.fetch(`${base}/robots.txt`)).headers.get(
        'etag',
    ) as string
    for (const given of [`W/${etag}`, `"other", ${etag}`, '*']) {
        const again = await Bun.fetch(`${base}/robots.txt`, {
            headers: { 'if-none-match': given },
        })
        expect(`${given} ${again.status}`).toBe(`${given} 304`)
    }
})

// 36.17 — a text type the extension names without a charset is given UTF-8's. THE REVERT: answer
// `Bun.file(file.path)` in `publicResponse`; the type reads `text/markdown` alone.
test('a public text file with no charset of its own is answered as UTF-8 — 36.17', async () => {
    expect(
        (await Bun.fetch(`${base}/notes.md`)).headers.get('content-type'),
    ).toBe('text/markdown; charset=utf-8')
})

// 15.17 — a public file and the bundle answer `GET` and `HEAD` alone. THE REVERT: drop both
// `readsOnly` checks in `answerRequest`; each POST is answered 200 with the file.
test('a public file and the bundle refuse another method 405 — 15.17', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    const entry = /src="([^"]*\/entry[^"]*\.js)"/.exec(html)?.[1] as string
    for (const path of ['/robots.txt', entry]) {
        const answer = await Bun.fetch(`${base}${path}`, { method: 'POST' })
        expect(`${path} ${answer.status}`).toBe(`${path} 405`)
        expect(answer.headers.get('allow')).toBe('GET, HEAD')
    }
})

// 16.35's range, on a public file, answered by the `answerBlobTagged` a returned `Blob` is. NOT A
// GATE ON THAT: Bun.serve ranges a file body of its own, so a public branch answering a bare
// `Bun.file` passes this too. What it holds is that the range keeps the public headers.
test('a public file answers a range 206 with the public headers — 16.35, 21.12', async () => {
    const { headers } = await Bun.fetch(`${base}/robots.txt`)
    const ranged = await Bun.fetch(`${base}/robots.txt`, {
        headers: { range: 'bytes=0-9' },
    })
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get('content-range')).toBe('bytes 0-9/23')
    expect(await ranged.text()).toBe('User-agent')
    expect(ranged.headers.get('cache-control')).toBe(
        // 21.23 — the fixture is served built, where the worker is registered.
        'public, max-age=0, stale-while-revalidate=604800, stale-if-error=31536000',
    )
    expect(ranged.headers.get('etag')).toBe(headers.get('etag'))
})

// THE REVERT: drop `ifRange` from `answerBlobTagged`'s range guard, and it answers 206 with the
// ten bytes of a version the reader does not have. Bun.serve declines a stale `If-Range` on a
// file-backed body itself since 1.4.3 — before that, the declined body had to be piped to hide it.
test('a public file answers a stale if-range in full — 16.35', async () => {
    const stale = await Bun.fetch(`${base}/robots.txt`, {
        headers: { range: 'bytes=0-9', 'if-range': '"not-the-etag"' },
    })
    expect(stale.status).toBe(200)
    expect(await stale.text()).toBe('User-agent: *\nAllow: /\n')
})

// A SECOND APP, AND IT EARNS THE SECOND BOOT. Everything above is asserted against an app that
// HAS a stylesheet and HAS a public directory, and the presence arm cannot tell either mechanism
// from one that is unconditional — writing the `<link>` always passes every test above, and so
// does a `publicFiles` that never handles an absent directory. This app has neither, which is
// also the shape of every app before its author adds one.
let stopBare: (() => void) | undefined
let bareBase = ''

beforeAll(async () => {
    ;({ base: bareBase, stop: stopBare } = await serveApp({
        'index.abide':
            '<head><title>Bare</title></head>\n<main id="bare">Bare</main>',
        // 23.22 — a package's directory, where its tsconfig stands beside the pages.
        'tsconfig.json': JSON.stringify({
            compilerOptions: { strict: true, target: 'esnext', types: [] },
            include: ['**/*'],
        }),
    }))
}, 30_000)

afterAll(() => {
    stopBare?.()
})

// 20.7, 36.7 — MCP AND OPENAPI ARE OPEN WHERE A HANDLER IS LISTED FOR THEM, and this app has none.
// THE REVERT: answer `McpSurface.opened` true, or hand back `openApi`'s document whatever its paths,
// and that one is answered 200 with an empty list.
test('an app that lists no handler for MCP or OpenAPI answers both 404 — 20.7, 36.7', async () => {
    const mcp = await Bun.fetch(`${bareBase}/__abide/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(mcp.status).toBe(404)
    await mcp.text()
    const openapi = await Bun.fetch(`${bareBase}/__abide/openapi.json`)
    expect(openapi.status).toBe(404)
    await openapi.text()
})

// THE REVERT: write the `<link>` in `clientTags` whatever the manifest says and this reports a
// document fetching a missing stylesheet on every load — and looking exactly right doing it.
test('an app that imports no stylesheet links none — 38.23', async () => {
    const html = await (await Bun.fetch(`${bareBase}/`)).text()
    expect(html).toContain('<main id="bare">Bare</main>')
    expect(html).not.toContain('rel="stylesheet"')
})

// THE REVERT: scan the public directory without testing for it, and `abide start` throws at boot
// rather than at a request — so this app serves nothing at all and the failure is the address
// never being printed.
test('an app with no public directory still boots and serves — 38.18', async () => {
    expect((await Bun.fetch(`${bareBase}/`)).status).toBe(200)
    expect((await Bun.fetch(`${bareBase}/robots.txt`)).status).toBe(404)
})

// 36.13 — NAMING BOTH: a public file and a page route are two walks of two different trees, and
// from inside either one the collision is invisible. Left to run time it is a silent preference,
// and which one wins is whatever the server happened to check first.
//
// THE REVERT: drop the `patterns.has` test in `refuseAddressCollision` and the build succeeds,
// after which `/about` is the FILE — the page is unreachable and nothing said so.
//
// `abide dev` ASKS THE SAME QUESTION — see the test beside this one. It did not, and that is
// what moved this out of `copyPublic`: the dev lane has no build step, so the clause bound in
// one of the two lanes that serve.
test('a public file claiming a page address is a build error naming both — 36.13', async () => {
    const app = temporaryModule({
        'about/index.abide': '<main>About</main>',
        'public/about': 'the file that shadows the page',
    })
    const built = await buildApp(app)

    expect(built.exitCode).not.toBe(0)
    const said = built.stderr
    // BOTH, which is the clause. Naming one leaves the reader to find the other.
    expect(said).toContain('public/about')
    expect(said).toContain('/about')
    expect(said).toContain('36.13')
}, 30_000)

// 38.100 OVER 38.6 — A BUILD THAT FAILED LEAVES NO BUILD BEHIND, so `abide start` builds again and
// says why rather than booting the half a refusal left. THE REVERT: write `compilation.json` ahead
// of 36.13's check; the second build fails with the first one's marker still there, and `start`
// boots it.
test('a build that fails leaves no build for start to boot — 38.100', async () => {
    const app = temporaryModule({ 'about/index.abide': '<main>About</main>' })
    expect((await buildApp(app)).exitCode).toBe(0)
    await Bun.write(`${app}/public/about`, 'the file that shadows the page')
    expect((await buildApp(app)).exitCode).not.toBe(0)
    expect(await Bun.file(`${app}/.abide/compilation.json`).exists()).toBe(
        false,
    )
}, 30_000)
