// 35.1 — A LAYOUT WRAPS THE PAGES UNDER IT, end to end: `abide build` finds the chain off the
// file tree and `abide start` serves a page inside it. There is no layout API and no second kind
// of component — a layout is a component with a `<slot/>` (32.18) and the router is what puts a
// page in it — so what is asserted here is the COMPOSITION rather than a second mechanism.
//
// A SUBPROCESS, for `serve.test.ts`'s reasons: happy-dom's preload replaces `Response` and
// `Bun.serve` refuses one it did not define.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import { addressOf, BIN } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

// The app's own document and chrome, and the one thing every page under it renders inside. ITS HEAD
// KEYS TOO (39.4): every level below replaces what it keys, and what no level keys stands.
const ROOT_LAYOUT = `<html><head><meta charset="utf-8"><title>Shell</title><meta name="theme-color" content="shell"><meta name="chrome" content="root"><meta name="description" content="root"></head><body>
<div id="chrome"><nav id="rail">rail</nav><main id="main"><slot/></main></div>
</body></html>`

// A section's chrome, which is the case a layout exists for: an invoices sidebar that does not
// mention the app's header.
const SECTION_LAYOUT = `<head><title>Section</title></head>

<section id="invoices"><h1>Invoices</h1><slot/></section>`

let server: Bun.Subprocess | undefined
let base = ''

beforeAll(async () => {
    const app = temporaryModule({
        'layout.abide': ROOT_LAYOUT,
        'index.abide': `<head><title>Home</title><meta name="description" content="home"></head>

<p id="home">home</p>`,
        // No level below the root layout keys a `<title>`, so the root layout's is the one it reads.
        'about/index.abide': `<p id="about">about</p>`,
        'invoices/layout.abide': SECTION_LAYOUT,
        'invoices/index.abide': `<head><title>Invoices</title></head>

<p id="list">two invoices</p>`,
        'invoices/[id]/index.abide': `<script>
import { props } from '@abide/abide'

const { params } = props<{ params: { id: string } }>()
</script>

<p id="one">invoice {params.id}</p>`,
        'package.json': JSON.stringify({
            name: 'layout-fixture',
            type: 'module',
            imports: { '#src/*': './*' },
        }),
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

    const built = await spawned(['bun', BIN, 'build'], { cwd: app })
    if (built.exitCode !== 0)
        throw new Error(`abide build failed: ${built.stderr}`)

    server = Bun.spawn(['bun', BIN, 'start', '--port', '0'], {
        cwd: app,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    base = await addressOf(server)
}, 30_000)

afterAll(() => {
    server?.kill()
    removeTemporaryModules()
})

// THE REVERT: drop `layouts` from the emitted table and every assertion below reports the page
// alone — which is a page that looks right and has lost its nav.
test('a page renders inside the layout above it — 35.1', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain('<nav id="rail">rail</nav>')
    expect(html).toContain('<p id="home">home</p>')
    // INSIDE, not beside: the page's markup stands where the layout's `<slot/>` was.
    const main = html.slice(
        html.indexOf('<main id="main">'),
        html.indexOf('</main>'),
    )
    expect(main).toContain('<p id="home">home</p>')
})

test('layouts nest, outermost first — 35.1', async () => {
    const html = await (await Bun.fetch(`${base}/invoices`)).text()
    expect(html).toContain('<nav id="rail">rail</nav>')
    expect(html).toContain('<h1>Invoices</h1>')
    expect(html.indexOf('id="rail"')).toBeLessThan(
        html.indexOf('id="invoices"'),
    )
    expect(html.indexOf('id="invoices"')).toBeLessThan(
        html.indexOf('id="list"'),
    )
})

// The chain is a PREFIX of the page's directory, so a section's layout wraps the pages below it
// too — and the page's own props reach it through the layouts rather than being lost in them.
test('a nested address renders inside both layouts, with its params — 33.4, 35.1', async () => {
    const html = await (await Bun.fetch(`${base}/invoices/42`)).text()
    expect(html).toContain('<p id="one">invoice 42</p>')
    expect(html).toContain('<h1>Invoices</h1>')
    expect(html).toContain('<nav id="rail">rail</nav>')
})

// 39.1 through a layout: the head a layout contributes and the head its page contributes both
// reach the document, and the page's is the deeper one.
test('a layout and its page both contribute to the head — 39.1', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain('<meta name="chrome" content="root">')
    expect(html).toContain('<title>Home</title>')
    expect(html.indexOf('content="root"')).toBeLessThan(
        html.indexOf('<title>Home</title>'),
    )
    // And both are in the head rather than in the body.
    expect(html.indexOf('<title>Home</title>')).toBeLessThan(
        html.indexOf('<body>'),
    )
})

// 39.4, 39.11 ON THE SERVER: the layout and the page both key a `<title>` and a
// `<meta name="description">`, and a browser reads the FIRST `<title>` — so a head written as the
// two contributions end to end is the outermost layout's, against the deepest winning.
// THE REVERT: write the head unmerged in `render` (no `mergeHead`) and the page reads `Shell`
// ahead of `Home`, and two descriptions, the root layout's first.
test("a page's keyed head contributions replace its layout's — 39.4", async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    const head = html.slice(0, html.indexOf('<body>'))
    expect(head.match(/<title>[^<]*<\/title>/g)).toEqual([
        '<title>Home</title>',
    ])
    expect(head.match(/<meta name="description"[^>]*>/g)).toEqual([
        '<meta name="description" content="home">',
    ])
    // Unkeyed by anything deeper, the layout's stands.
    expect(head).toContain('<meta name="chrome" content="root">')
    const nested = await (await Bun.fetch(`${base}/invoices/42`)).text()
    expect(
        nested
            .slice(0, nested.indexOf('<body>'))
            .match(/<title>[^<]*<\/title>/g),
    ).toEqual(['<title>Section</title>'])
})

// 39.4 — THE DOCUMENT'S HEAD IS THE OUTERMOST CONTRIBUTOR, and the root layout's is the next: abide's
// own document carries an encoding the root layout writes again, and a browser reads the first
// `<title>`, so a root title ahead of the page's would beat it on every server-painted page.
// THE REVERT: drop `meta charset` from `headKeyOf`, and `/` carries two `<meta charset>`.
test("a level's keyed head contributions replace the one above — 39.4", async () => {
    const titles = (html: string): string[] | null =>
        html.slice(0, html.indexOf('<body>')).match(/<title>[^<]*<\/title>/g)
    const home = await (await Bun.fetch(`${base}/`)).text()
    const head = home.slice(0, home.indexOf('<body>'))
    expect(titles(home)).toEqual(['<title>Home</title>'])
    expect(head.match(/<meta name="description"[^>]*>/g)).toEqual([
        '<meta name="description" content="home">',
    ])
    // Keyed by no level below the root, the root layout's stands — once.
    expect(head.match(/<meta name="theme-color"[^>]*>/g)).toEqual([
        '<meta name="theme-color" content="shell">',
    ])
    expect(head.match(/<meta charset[^>]*>/g)).toEqual([
        '<meta charset="utf-8">',
    ])
    const about = await (await Bun.fetch(`${base}/about`)).text()
    expect(titles(about)).toEqual(['<title>Shell</title>'])
})

// 39.4 THREE LEVELS DEEP: a page under a section layout, both keying a `<title>`. A level's head is
// read lazily, and reading it builds the level — so the section's head, read after its own build had
// pushed the page's, landed after it, and the section's title beat the page's.
// THE REVERT: push `below.head` where it is read rather than into a slot taken first, and
// `/invoices` reads `Section`.
test("a page's keyed head contributions replace its section layout's — 39.4", async () => {
    const html = await (await Bun.fetch(`${base}/invoices`)).text()
    expect(
        html.slice(0, html.indexOf('<body>')).match(/<title>[^<]*<\/title>/g),
    ).toEqual(['<title>Invoices</title>'])
})
