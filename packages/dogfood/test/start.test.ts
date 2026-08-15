// `abide start` — this example, served by the binary rather than by a server it wrote.
//
// Not a demo, for the reason `build.test.ts` and `lifecycle.test.ts` are not: a demo case runs the
// same body headless AND inside a browser card, and a card cannot bind a socket, spawn a process or
// read what a bundler wrote. What is card-showable about the pieces underneath — the middleware
// onion, the render walk, the route table — is already in `demos/lifecycle.ts` and `demos/server.ts`.
//
// The claim every case here is a face of: `app.ts` exports HOOKS and nothing else — no route, no
// render, no server — and the app that comes up has its pages served in its own `app.html`, with
// hydration markers, the endpoints, the client bundle and a drain on SIGTERM. So the assertions are
// all about a real process on a real port.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { CLIENT_ROUTE, type ClientManifest, MANIFEST_FILE } from 'abide/cli'
import { abide, BINARY, ended, type Running, spawn, started } from 'harness/spawn'
import { DOGFOOD_ROOT as ROOT } from './root.ts'

let app: Running
let manifest: ClientManifest
/** What `client.ts` compiled to, which is the only name that is not a guess. */
let entry: string

// Port `0` throughout — the kernel's own spelling of "whatever is free". A fixed port would make this
// file a test of what else is running on this machine. The one case that NEEDS a fixed port is the one
// about a port being taken, and it takes one it holds itself.

beforeAll(async () => {
    const built = await abide(['build'], { cwd: ROOT })
    expect(built.code).toBe(0)
    manifest = (await Bun.file(`${ROOT}/${MANIFEST_FILE}`).json()) as ClientManifest
    entry = manifest.entries['client.ts'] as string
    app = await started(['start', '--port', '0'], ROOT)
}, 30_000)

afterAll(() => {
    app?.child.kill('SIGKILL')
})

test('a page renders through its layouts, inside the app’s own onion', async () => {
    const answered = await fetch(`${app.base}users/42`)
    expect(answered.status).toBe(200)
    expect(answered.headers.get('content-type')).toContain('text/html')

    const markup = await answered.text()
    // Both layouts and the page, which is the whole of what `pages()` + `outlet()` claim — and the
    // param reached the page off the REQUEST, with nothing in the app navigating anywhere.
    expect(markup).toContain('<section class="users">')
    expect(markup).toContain('42')
    // Hydratable: the markers are what the built client adopts by, and the script that does it is
    // named by the manifest rather than by a convention this test could have got wrong.
    expect(markup).toContain(`<script type="module" src="${CLIENT_ROUTE}${entry}">`)
    expect(markup).toContain('<!--$0-->')

    // The app's rung ran on the way back out, and `handle` opened the scope that names the operation.
    expect(answered.headers.get('x-dogfood')).toBe('served')
    expect(answered.headers.get('traceresponse')).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/)
})

test('a route’s own chunks are named in its head, so the entry is not what discovers them', async () => {
    // The waterfall this removes: a page reached through `() => import(…)` is absent from the first
    // load on purpose, but the browser cannot ASK for it until the entry has downloaded, parsed and
    // run far enough to reach the call — two serial round trips of JavaScript before the page is
    // interactive. The chunk names are in the manifest's graph, so the document can name them.
    const nested = await (await fetch(`${app.base}users/42`)).text()
    const preloaded = [...nested.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1])
    expect(preloaded.length).toBeGreaterThan(0)

    // Every name is a file the build actually wrote — the manifest is the allowlist, so a preload it
    // does not carry is a 404 the browser eats on every page view.
    for (const href of preloaded) {
        expect(href?.startsWith(CLIENT_ROUTE)).toBe(true)
        expect(manifest.assets[href?.slice(CLIENT_ROUTE.length) as string]).toBeDefined()
    }

    // This route's page AND the layout nested above it, which is the half a flat "preload the entry"
    // would miss: `/users/[id]` renders through `users/layout.abide` and the root layout both.
    const graph = manifest.graph as NonNullable<ClientManifest['graph']>
    const own = graph.modules['pages/users/[id]/page.abide'] as string
    const layout = graph.modules['pages/users/layout.abide'] as string
    expect(preloaded).toContain(`${CLIENT_ROUTE}${own}`)
    expect(preloaded).toContain(`${CLIENT_ROUTE}${layout}`)

    // And it is PER ROUTE rather than one list every page carries: the home page reaches neither of
    // the two above, and shipping them with it would put the whole route table in the first load —
    // which is the splitting this is meant to make cheap, undone.
    const home = await (await fetch(app.base)).text()
    expect(home).not.toContain(own)
    expect(home).not.toContain(layout)
})

test('a client-side navigation is a real request, so it passes the app’s middleware', async () => {
    const answered = await fetch(`${app.base}users/42`, { headers: { 'x-abide-navigation': '1' } })
    expect(answered.status).toBe(200)

    // The whole claim, and the reason this is a header on the real URL rather than an endpoint under
    // `/__abide/`: that prefix is dispatched in FRONT of the onion, so a rung would never see it.
    // Auth on a page is middleware, and a navigation that skipped it would be the one path into the
    // app that nothing authorized.
    expect(answered.headers.get('x-dogfood')).toBe('served')

    const markup = await answered.text()
    // The outlet and nothing around it: the client is already looking at the document, so a second
    // head is bytes it would parse and throw away.
    expect(markup).toContain('<section class="users">')
    expect(markup).toContain('42')
    expect(markup).not.toContain('<!doctype')
    expect(markup).not.toContain('<script type="module"')

    // Hydratable, because the part showing the outlet ADOPTS this rather than building over it —
    // the markers are the whole of what makes that possible.
    expect(markup).toContain('<!--$0-->')

    // Marked, so the client can tell a page from whatever else an app's route may answer with; and
    // varied, so a shared cache never hands this fragment to a browser opening the page cold.
    expect(answered.headers.get('x-abide-navigation')).toBe('1')
    expect(answered.headers.get('vary')).toContain('x-abide-navigation')
})

test('the same url without the mark is still the whole document', async () => {
    // The negative half of the case above: one URL, two bodies, and the ONLY thing that separates
    // them is the request header — which is exactly why `Vary` has to name it.
    const answered = await fetch(`${app.base}users/42`)
    const markup = await answered.text()
    expect(markup).toContain('<!doctype')
    expect(answered.headers.get('x-abide-navigation')).toBeNull()
})

/**
 * Every chunk of a response, with how long after the request it landed.
 *
 * IDENTITY, and that is the point of the header rather than an oversight: what these tests time is
 * when the RENDER wrote each piece, and Bun's `fetch` holds a compressed body in its decoder until
 * more of it arrives — the head of a document measured this way landed at 123 ms where the same
 * bytes were on the socket at 5.6 ms. The compressor's own claim is that it does not do that, and it
 * is asserted where it belongs: `the compressed head is on the wire before the slow panel settles`,
 * below, reads the socket rather than a decoded body. Asking for identity here keeps the two apart, so a
 * change to either one fails the test that is about it.
 */
async function chunks(path: string, headers: Record<string, string> = {}): Promise<Timed[]> {
    const started = performance.now()
    const answered = await fetch(`${app.base}${path}`, {
        headers: { ...headers, 'accept-encoding': 'identity' },
    })
    const seen: Timed[] = []
    // A reader and a decoder by hand rather than `pipeThrough(new TextDecoderStream())`: what is
    // being timed is when each chunk ARRIVES, and a transform stream sits between the socket and the
    // stamp. `{ stream: true }` so a multi-byte character split across two chunks still decodes.
    const reader = (answered.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        seen.push({ at: performance.now() - started, text: decoder.decode(value, { stream: true }) })
    }
    return seen
}

interface Timed {
    at: number
    text: string
}

const WAIT_MS = 400

/** The page's own fixed control delay — much shorter, and BELOW the slow panel on the page. */
const FAST_MS = 50

/** When a chunk containing `mark` landed, in ms after the request went out. */
function arrival(seen: Timed[], mark: string): number {
    const found = seen.find((chunk) => chunk.text.includes(mark))
    if (found === undefined) throw new Error(`nothing in the response contained ${JSON.stringify(mark)}`)
    return found.at
}

test('a suspended page streams out of ORDER: a fast panel does not wait for a slow one', async () => {
    // `/streaming` is the one route in this app that suspends, and it has TWO panels because one
    // cannot distinguish the lanes: both flush before they wait, so a single-suspend page looks
    // nearly the same either way. Slow first, fast second, is what makes the ordering visible.
    const seen = await chunks(`streaming?ms=${WAIT_MS}`)

    // Everything static, plus both placeholders, before EITHER load settled. Asserted against the
    // arrivals themselves rather than against a wall number: a threshold in milliseconds is a claim
    // about the machine running the suite, and this one has to survive a loaded CI box.
    const fast = arrival(seen, 'the fast load settled')
    const slow = arrival(seen, 'the load settled')
    for (const early of [`waiting ${WAIT_MS}ms`, `waiting ${FAST_MS}ms`, 'Static markup below both panels']) {
        expect(arrival(seen, early)).toBeLessThan(fast)
    }

    // The claim, and it is about ORDER IN TIME rather than bytes — a render that awaited everything
    // before writing produces an identical document, which is exactly why arrival is what is asserted.
    // The fast panel is SECOND on the page and must still land first; the slow one really waited.
    expect(fast).toBeLessThan(slow)
    expect(slow).toBeGreaterThanOrEqual(WAIT_MS * 0.8)
})

test('a navigation streams out of order too — the same page, without the document', async () => {
    const seen = await chunks(`streaming?ms=${WAIT_MS}`, { 'x-abide-navigation': '1' })

    // The same claim as the document case above, which is the whole point: a navigation is not a
    // second-class render. `renderFragment` gives it a document context, so `suspend` DEFERS here too.
    const fast = arrival(seen, 'the fast load settled')
    const slow = arrival(seen, 'the load settled')
    for (const early of [`waiting ${WAIT_MS}ms`, `waiting ${FAST_MS}ms`, 'Static markup below both panels']) {
        expect(arrival(seen, early)).toBeLessThan(fast)
    }

    // And the fast panel is no longer held behind the slow one it sits below. This is the assertion
    // that INVERTED: it read `slow < fast` while every block was awaited in document order.
    expect(fast).toBeLessThan(slow)
    expect(slow).toBeGreaterThanOrEqual(WAIT_MS * 0.8)
})

test('a navigation carries no patch SCRIPT — the client swaps the placeholders itself', async () => {
    const seen = await chunks(`streaming?ms=${WAIT_MS}`, { 'x-abide-navigation': '1' })
    const whole = seen.map((chunk) => chunk.text).join('')

    // The one thing a fragment cannot reuse from the document protocol. A `<script>` the client
    // injects while parsing this itself would never run — the HTML spec makes script elements
    // inserted that way non-executable — so a fragment that shipped one would silently never patch.
    expect(whole).not.toContain('<script')
    expect(whole).not.toContain('$p(')

    // What it carries instead: a placeholder per deferred subtree, a bare `<template>` per patch, and
    // a sentinel after every complete piece. HTML cannot be parsed halfway, so the sentinel is what
    // tells the client that what it is holding is a whole tree rather than a prefix of one.
    expect(whole).toContain('<slot-s id="s0">')
    expect(whole).toContain('<template id="t0">')
    expect(whole).toContain('<!--abide:piece-->')

    // One sentinel per piece: the in-order pass, then one per suspended panel.
    expect(whole.split('<!--abide:piece-->').length - 1).toBe(3)
})

test('a path that is no route is a 404, and a method that is no page falls through to one', async () => {
    // Two 404s with two different authors, which is the distinction this case exists for.
    //
    // ABIDE's: nothing in the pages directory matches `/nowhere` at all, so the router answers. There is
    // no catch-all any more — `[suite]` used to sit at the ROOT and match every single-segment path, so
    // this used to be the app's answer rather than the framework's.
    const missing = await fetch(`${app.base}nowhere`)
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { error: { name: string } }).error.name).toBe('AbideRouteError')

    // The APP's: `/docs/[callable]` matches anything in its one segment, so the only half of this app
    // that knows `nowhere` is not a name abide exports is `app.ts`, asked before the pages.
    const noCallable = await fetch(`${app.base}docs/nowhere`)
    expect(noCallable.status).toBe(404)
    expect(await noCallable.text()).toContain('no callable named nowhere')

    // And the other vocabulary, which is a different list on the same gate: a SUITE name is an address
    // under `/bench` and not under `/docs`, so `template` is a 200 there and a 404 above.
    const noSuite = await fetch(`${app.base}bench/nowhere`)
    expect(noSuite.status).toBe(404)
    expect(await noSuite.text()).toContain('no suite named nowhere')

    // And this one is abide's, on the same route the app just declined to claim: a POST is not a page
    // read, the app's own route answers `undefined`, and `handle` decides what that means. Which is
    // why an app writes a 404 only for the case its route table cannot express.
    const posted = await fetch(`${app.base}users/42`, { method: 'POST' })
    expect(posted.status).toBe(404)
    expect(((await posted.json()) as { error: { name: string } }).error.name).toBe('AbideRouteError')
})

test('the endpoints are in front of the app, without the app mounting anything', async () => {
    const health = await fetch(`${app.base}__abide/health`)
    expect(health.status).toBe(200)
    // The baseline, and the app's own `onHealth` export merged OVER it — read off the module by the
    // binary, not registered by a line the app wrote.
    const account = (await health.json()) as { reachable: boolean; example?: { serving: boolean } }
    expect(account.reachable).toBe(true)
    expect(account.example).toEqual({ serving: true })

    // A transport module is registered because the BOOT scanned for it, and the wire is the same one
    // `transport.test.ts` asserts against — here it is reached through the binary's own server.
    // A URL anyone could have typed: one parameter per argument, and `7` is a number because the
    // handler's own annotation says the id is one.
    const user = await fetch(`${app.base}__abide/rpc/users/getUser?id=7`)
    expect(user.status).toBe(200)
    expect((await user.json()) as { id: number }).toMatchObject({ id: 7 })
})

test('a handler serves because of where it SITS, not because something imported it', async () => {
    // The falsifiable half: the app's own module IMPORTS none of its endpoints. A list of
    // side-effect imports kept in step by hand is a 404 on the endpoint somebody forgot to add.
    //
    // Import statements rather than the text — the file's own header talks about `server/rpc`, and a
    // comment about a thing is not the thing. (Third time in this change set that mattered.)
    const source = await Bun.file(`${ROOT}/app.ts`).text()
    const imports = source.split('\n').filter((line) => line.startsWith('import '))
    expect(imports.some((line) => line.includes('server/rpc') || line.includes('server/sockets'))).toBe(false)

    const catalogue = (await (await fetch(`${app.base}__abide/schema`)).json()) as { id: string }[]
    const ids = catalogue.map((endpoint) => endpoint.id)
    expect(ids).toContain('users/getUser')
    expect(ids).toContain('admin/audit/recent')
    expect(ids).toContain('feed/ticks')

    // And ANCHORED at the root: `types/checker/server/rpc/` holds fixtures for the shapes pass, which
    // are transport modules by the same directory rule and are not this app's endpoints. A scan that
    // matched a transport directory anywhere under the tree would register them — and `both.ts` would
    // land on the same address a real `server/rpc/both.ts` would, because an id is cut at the LAST
    // transport directory in a path.
    for (const id of ids) {
        expect(id.startsWith('both/') || id.startsWith('computed/') || id.startsWith('channels/')).toBe(false)
    }
})

test('the bundle is served immutable, precompressed, and in front of the onion', async () => {
    const address = `${app.base}${CLIENT_ROUTE.slice(1)}${entry}`

    const compressed = await fetch(address, { headers: { 'accept-encoding': 'br' } })
    expect(compressed.status).toBe(200)
    expect(compressed.headers.get('content-encoding')).toBe('br')
    // The identity form's type on the compressed bytes: `Content-Encoding` says how they are wrapped,
    // and a browser handed the `.br` extension's type would refuse to execute the module.
    expect(compressed.headers.get('content-type')).toContain('javascript')
    expect(compressed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(compressed.headers.get('vary')).toBe('accept-encoding')
    // In FRONT of the request pipeline: a static file has no caller to be about, and a page waiting
    // on an auth rung for its own JavaScript is a page that cannot log in.
    expect(compressed.headers.get('x-dogfood')).toBeNull()

    // Bun's fetch decodes what it accepted, so the bytes it hands back are the module either way —
    // and what is IN them is the route table, which is what the generated lane exists to carry. The
    // ELISION is asserted where the stub now lands, in `pages/users/[id]`'s chunk; see `build.test.ts`.
    expect(await compressed.text()).toContain('"/users/[id]"')

    const plain = await fetch(address, { headers: { 'accept-encoding': 'identity' } })
    expect(plain.headers.get('content-encoding')).toBeNull()
    expect(plain.headers.get('vary')).toBe('accept-encoding')

    // A weight of zero is a caller REFUSING that encoding, which is the whole reason the parameters
    // are read rather than the token being searched for.
    const refused = await fetch(address, { headers: { 'accept-encoding': 'br;q=0, gzip' } })
    expect(refused.headers.get('content-encoding')).toBe('gzip')
})

test('the manifest is the allowlist, so a name it does not carry is a 404', async () => {
    const missing = await fetch(`${app.base}${CLIENT_ROUTE.slice(1)}nothing-0000000.js`)
    expect(missing.status).toBe(404)

    // There is no path to traverse: this is a name to look up, and no name in a manifest ever spells
    // one. The encoded form is what a proxy would hand over intact.
    const traversal = await fetch(`${app.base}${CLIENT_ROUTE.slice(1)}..%2f..%2fpackage.json`)
    expect(traversal.status).toBe(404)
    expect(await traversal.text()).not.toContain('"name"')

    const posted = await fetch(`${app.base}${CLIENT_ROUTE.slice(1)}${entry}`, { method: 'POST' })
    expect(posted.status).toBe(405)
    expect(posted.headers.get('allow')).toBe('GET, HEAD')
})

test('the page is served in the app’s own app.html, in the slot', async () => {
    const markup = await (await fetch(app.base)).text()

    // The app's document, verbatim: its `lang`, its `<meta>`, its title. abide adds to it and
    // rewrites nothing else — a shell is an ordinary html file, not a template.
    expect(markup).toStartWith('<!doctype html>')
    expect(markup).toContain('<html lang="en">')
    expect(markup).toContain('<title>abide example</title>')

    // And the page is INSIDE the slot, which is what the client hydrates: the placeholder the file
    // can be read with is gone, and the tags that held it are still there.
    //
    // Read from `<body>` on purpose. This document's own head comment TALKS about `<slot></slot>`,
    // and a naive first-occurrence search lands in the sentence rather than in the element — which is
    // exactly the trap the shell parser has to avoid, so the test that proves it must not fall in.
    const body = markup.slice(markup.indexOf('<body>'))
    const inSlot = body.slice(body.indexOf('<slot>') + '<slot>'.length, body.indexOf('</slot>'))
    expect(inSlot).not.toContain('loading…')
    // The hub, rendered: its heading, the four ways in, and the index of capabilities under them.
    // Server-rendered with nothing having run — the hub links to the sections rather than being one.
    expect(inSlot).toContain('>abide<')
    expect(inSlot).toContain('the capabilities')
    expect(inSlot).toContain('href="/tests"')
    // Nothing else of abide's is in there. A `<script>` the shell did not write is an element the
    // hydrating client would find where its own first node should be.
    expect(inSlot).not.toContain('<script')

    // A comment that TALKS about the slot is not the slot, and the same for one naming `./client.ts`
    // — the document explaining itself is the first document anybody writes.
    expect(markup).toContain('`src="./client.ts"` names the')
})

test('a stylesheet a page imported is built, linked and served', async () => {
    const markup = await (await fetch(app.base)).text()

    // `pages/layout.abide` writes `import '../app.css'` and `app.html` names no stylesheet at all:
    // the link comes off the BUILD, so an app that renames its css cannot end up with a document
    // pointing at a file that is no longer there.
    const link = /<link rel="stylesheet" href="([^"]+)">/.exec(markup)
    expect(link).not.toBeNull()
    const href = (link as RegExpExecArray)[1] as string
    expect(href).toStartWith(CLIENT_ROUTE)
    // In the head, where a stylesheet belongs, rather than wherever the page happened to import it.
    expect(markup.indexOf(href)).toBeLessThan(markup.indexOf('</head>'))

    const styles = await fetch(`${app.base}${href.slice(1)}`)
    expect(styles.status).toBe(200)
    expect(styles.headers.get('content-type')).toContain('text/css')
    expect(styles.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    // The app's OWN rules, not just the framework the plugin generated around it. Both markers are
    // things only `app.css` writes and Tailwind never emits on its own, which is what makes finding
    // them proof that the file the page imported went through the plugin this app declared in its
    // bunfig and came out the other side.
    //
    // `view-transition-name` rather than a colour: the palette moved into `@theme`, so a token like
    // `--color-ground` now appears in Tailwind's OWN output too and would pass this test even if the
    // app's half of the sheet had been dropped entirely. A marker that survives the thing it is
    // meant to detect is not a marker.
    const text = await styles.text()
    expect(text).toContain('view-transition-name:chrome')
    expect(text).toContain('-webkit-font-smoothing:antialiased')
})

test('SIGTERM drains through the app’s onStop and closes the socket', async () => {
    // Its OWN process, named apart from the module-level `app` every other case fetches against —
    // this one is signalled, and a shadowed name would make `app.base` mean two things in one file.
    const doomed = await started(['start', '--port', '0'], ROOT)
    const base = doomed.base
    expect((await fetch(`${base}__abide/health`)).status).toBe(200)

    doomed.child.kill('SIGTERM')
    // The app's hook, wrapped around the close — the binary handed `onStop` over the same way it
    // handed `onStart` over, and the exit is abide's.
    expect(await doomed.until('draining')).toContain('draining')
    expect(await doomed.child.exited).toBe(0)

    const after = await fetch(`${base}__abide/health`).then(
        () => 'still listening',
        () => 'closed',
    )
    expect(after).toBe('closed')
}, 15_000)

test('--port binds directly, and a taken one is a refusal rather than a hop', async () => {
    // Held by this process, so the port is genuinely in use and this case does not depend on
    // anything else running — and held the way `abide start` holds one, which is the whole of what
    // this row tests. A BARE holder cannot: SO_REUSEPORT only lets a second socket in when the
    // FIRST one set it too, so a holder that does not looks in-use to any binder and the refusal
    // fires however `abide start` binds. The case the comment below is about is the deploy meeting
    // the process it replaces, and that one is another `development: false` server.
    const holder = Bun.serve({ port: 0, development: false, fetch: () => new Response('mine') })
    const port = holder.port
    const taken = await ended(spawn(['bun', BINARY, 'start', '--port', String(port)], { cwd: ROOT }))
    holder.stop(true)

    // HARD, and that is the point of the row: `abide dev` hops so a developer's app comes up, and a
    // deploy that quietly listened somewhere else is a health check passing against the process it
    // was meant to replace.
    expect(taken.code).toBe(1)
    expect(taken.err).toContain(`port ${port} is already in use`)
    expect(taken.out).not.toContain('listening')
}, 15_000)

test('a port that is not one, and an option that is not ours, are usage', async () => {
    const nonsense = await abide(['start', '--port', 'nope'], { cwd: ROOT })
    expect(nonsense.code).toBe(2)
    expect(nonsense.err).toContain('is not a port')

    const unknown = await abide(['start', '--watch'], { cwd: ROOT })
    expect(unknown.code).toBe(2)
    expect(unknown.err).toContain('unknown option')
})

test('what makes a directory an app: nothing refuses, pages with no build refuse, endpoints alone come up', async () => {
    const empty = await mkdtemp(`${tmpdir()}/abide-start-`)
    try {
        const nothing = await abide(['start'], { cwd: empty })
        expect(nothing.code).toBe(2)
        expect(nothing.err).toContain('no app here')

        // The one shape that is unambiguously a mistake: there are pages and the bundle is not there,
        // so every `<script>` they emit would 404. Asked of `pages/` and not of a client entry,
        // because the lane is generated from the one and there is no longer any such thing as the
        // other. Refused before anything binds, and the message is the command that fixes it.
        await Bun.write(`${empty}/app.ts`, 'export default (): undefined => undefined\n')
        await Bun.write(`${empty}/pages/page.abide`, '<h1>home</h1>\n')
        const unbuilt = await abide(['start'], { cwd: empty })
        expect(unbuilt.code).toBe(1)
        expect(unbuilt.err).toContain('run `abide build`')

        // And the shape that is NOT a mistake: no pages, and a module that exports no route at all.
        // That is an app made of endpoints, and it comes up — `/__abide/**` is served without the app
        // mounting anything, which is the whole reason this is allowed to start.
        await rm(`${empty}/pages`, { recursive: true })
        await Bun.write(`${empty}/app.ts`, 'export const onHealth = (): unknown => ({ empty: true })\n')
        const endpoints = await started(['start', '--port', '0'], empty)
        try {
            const account = (await (await fetch(`${endpoints.base}__abide/health`)).json()) as {
                empty?: boolean
            }
            expect(account.empty).toBe(true)
            // Nothing of its own: every other path is `handle`'s 404 rather than a crash.
            expect((await fetch(endpoints.base)).status).toBe(404)
        } finally {
            endpoints.child.kill('SIGKILL')
        }

        // And the shape with no module at all. Every export `app.ts` can hold is optional, so the
        // file is: an app of endpoints that wants no hook and no route of its own has nothing to put
        // in one. What makes this a directory worth serving is that there is something IN it — the
        // handler is found by the same scan, registered by being where it is, and answers.
        await rm(`${empty}/app.ts`)
        await mkdir(`${empty}/server/rpc`, { recursive: true })
        await Bun.write(
            `${empty}/server/rpc/ping.ts`,
            "import { GET } from 'abide/server'\n\nexport const ping = GET((): unknown => ({ pong: true }))\n",
        )
        // Through the link the dogfood app itself resolves `abide` by, rather than a relative path into
        // the framework: a fixture is an app, and an app reads the public specifier and its exports
        // map. `node_modules` because that is where a resolver looks, wherever the fixture landed.
        await mkdir(`${empty}/node_modules`, { recursive: true })
        await symlink(`${ROOT}/node_modules/abide`, `${empty}/node_modules/abide`)

        const bare = await started(['start', '--port', '0'], empty)
        try {
            const pong = (await (await fetch(`${bare.base}__abide/rpc/ping/ping`)).json()) as {
                pong?: boolean
            }
            expect(pong.pong).toBe(true)
        } finally {
            bare.child.kill('SIGKILL')
        }
    } finally {
        await rm(empty, { recursive: true, force: true })
    }
})

test('a document is compressed, and the compression does not hold the stream back', async () => {
    const answered = await fetch(`${app.base}streaming?ms=${WAIT_MS}`, {
        headers: { 'accept-encoding': 'gzip' },
    })
    expect(answered.headers.get('content-encoding')).toBe('gzip')
    // The header is what a shared cache reads before it hands one caller's bytes to another, and
    // there are now two things this url varies on. Both have to be named or a cache picks one.
    expect(answered.headers.get('vary')).toContain('accept-encoding')

    // Decoded, so this is the same document either way — the bytes it took to send are what the
    // socket case below counts, because a streamed response carries no `content-length` to read.
    const markup = await answered.text()
    expect(markup).toContain('<!doctype')

    // A caller that refuses it gets the bytes as they are, and the same `vary` beside them.
    const plain = await fetch(`${app.base}streaming?ms=${WAIT_MS}`, {
        headers: { 'accept-encoding': 'gzip;q=0' },
    })
    expect(plain.headers.get('content-encoding')).toBeNull()
    expect(plain.headers.get('vary')).toContain('accept-encoding')
})

test('a BIG answer is compressed too, a small one is not, and a framed one is left alone', async () => {
    // The case this exists for: an rpc that answers a list a page then filters in the browser. The
    // rule used to be markup-only, on the premise that everything else an endpoint answers is small
    // — right for a `getUser`, and wrong by 7.9x for a payload whose whole purpose is to cross the
    // wire once and be worked on client-side.
    // `add` ECHOES what it was sent, so the size of the answer is this test's to choose rather than a
    // fixture's to keep — a case body would have done, until somebody shortened it and failed a test
    // about compression.
    const echo = (name: string): Promise<Response> =>
        fetch(`${app.base}__abide/rpc/users/add`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'accept-encoding': 'gzip' },
            body: JSON.stringify({ name }),
        })

    const big = await echo('winter harbour '.repeat(1000))
    expect(big.status).toBe(200)
    const declared = Number(big.headers.get('content-length'))
    const body = await big.text()
    expect(body.length).toBeGreaterThan(4096)
    expect(big.headers.get('content-encoding')).toBe('gzip')
    // The RATIO is the claim, not a byte count: whatever the payload is, the wire form is smaller
    // than the answer, and highly repetitive text is what makes the gap unmistakable.
    expect(declared).toBeLessThan(body.length)
    expect(big.headers.get('vary')).toContain('accept-encoding')

    // Under the threshold, where the compressor is the more expensive half and the premise holds.
    const small = await echo('ada')
    expect((await small.text()).length).toBeLessThan(4096)
    expect(small.headers.get('content-encoding')).toBeNull()

    // FRAMED, and the reason the rule is an allow-list on the type rather than a size alone: this one
    // is read as it arrives, so buffering it to measure would undo what it is for.
    const framed = await fetch(`${app.base}__abide/rpc/users/countdown?from=3`, {
        headers: { 'accept-encoding': 'gzip' },
    })
    expect(framed.headers.get('content-type')).toContain('ndjson')
    expect(framed.headers.get('content-encoding')).toBeNull()
    await framed.text()
})

/**
 * The seed block a document or a fragment carries, parsed. One spelling of the element for both —
 * the two cases below differ in WHERE the block goes, not in what it is.
 */
const SEED_BLOCK = /<script type="application\/json" id="abide-seed"[^>]*>([\s\S]*?)<\/script>/

function seedsIn(text: string): Record<string, unknown> {
    const block = SEED_BLOCK.exec(text)
    expect(block).not.toBeNull()
    return JSON.parse((block as RegExpExecArray)[1] as string) as Record<string, unknown>
}

/**
 * The key an endpoint's answer is under. Keyed by the endpoint's ADDRESS and the args, which is what
 * lets the browser find it without either side being told about the other: the address is what the
 * compiler wrote into the stub, and the args key is what a keyed memo already addresses its slot by.
 */
function seedKeyIn(seeded: Record<string, unknown>, prefix: string): string {
    const key = Object.keys(seeded).find((name) => name.startsWith(prefix))
    expect(key).toBeDefined()
    return key as string
}

test('a document hands the client what the render already resolved', async () => {
    // The recall this exists to remove: the server calls the handler to build the markup, the client
    // adopts that markup, and the client's own slot is cold — so its first read fetches an answer that
    // is already on screen. Measured on the perf app before this: a 254 KB document followed by a
    // 623 KB fetch, and the handler ran TWICE because a slot is per-caller and the browser is a
    // different caller.
    const markup = await (await fetch(`${app.base}users/42`)).text()
    expect(markup).toContain('id="abide-seed"')

    const seeded = seedsIn(markup)
    const key = seedKeyIn(seeded, 'users/getUser?')
    expect(seeded[key]).toEqual({ id: 42, name: expect.any(String), connections: expect.any(Number) })

    // The page RENDERED that name, so the seed is not carrying anything the markup did not already
    // say — which is the exposure question `RpcOptions.seed` exists to answer when it does.
    expect(markup).toContain((seeded[key] as { name: string }).name)

    // A CSP nonce, because a policy that reached this render reaches every script element in it —
    // this one is a data block and is never executed, but a policy does not read `type`.
    expect(/id="abide-seed" nonce="[^"]+"/.test(markup)).toBe(true)

    // The seeded value is the SAME ANSWER the client would have fetched, which is the failure this
    // catches and nothing else would: a seed that serialises differently from the wire form — a date,
    // an `undefined` field, a class instance — leaves a page that hydrates to something subtly other
    // than what a reload gives it, and every test about the markup still passes.
    const overTheWire = await (await fetch(`${app.base}__abide/rpc/users/getUser?id=42`)).json()
    expect(seeded[key]).toEqual(overTheWire)
})

test('a declaration can decline to be handed over, and the page still renders it', async () => {
    // The OFF arm of `RpcOptions.seed`, which had never run: nothing in either app passed the option,
    // so `options.seed !== false` had one live value and a sweep reading "an option nothing passes"
    // would have deleted it — leaving SPEC describing a knob that was gone.
    const markup = await (await fetch(`${app.base}users/42`)).text()
    const seeded = seedsIn(markup)

    // Both endpoints ran during this render. The proof for the unseeded one is its VALUE in the
    // markup: an endpoint that was simply never called would also be absent from the table, and that
    // is the reading this has to rule out. Markers stripped because a child slot puts a comment
    // between the static text and the value, so the two are not adjacent in the source.
    const rendered = markup.replace(/<!--[\s\S]*?-->/g, '')
    expect(rendered).toContain('visits: 7')
    expect(Object.keys(seeded).some((name) => name.startsWith('users/getUser?'))).toBe(true)
    expect(Object.keys(seeded).some((name) => name.startsWith('users/userActivity'))).toBe(false)

    // And the fields the page did not render are in NEITHER — which is the exposure half, and the
    // reason the shape SPEC names for turning it off is "an answer carrying fields the page did not
    // render" rather than "a big answer".
    expect(markup).not.toContain('renamed themselves')

    // Still reachable, because `seed: false` is about the document and not about the endpoint: the
    // client's first read goes to the wire and gets the whole answer.
    const overTheWire = (await (await fetch(`${app.base}__abide/rpc/users/userActivity?id=42`)).json()) as {
        trail: string[]
    }
    expect(overTheWire.trail).toContain('renamed themselves')
})

test('a navigation carries them too, as its last piece', async () => {
    // The same recall, on every navigation after the first: the fragment is rendered by calling the
    // handler, the client adopts that markup, and its slot is cold. What differs is WHERE the block
    // can go — a document writes it before the client hydrates, and a navigation cannot, because the
    // client is holding the stream. It commits only once the stream ends (`router.ts`'s `enter`
    // awaits `complete` before `commit`), so the last piece is early enough — and late enough to
    // carry what the DRAIN resolved, which a document's placement could not.
    const answered = await fetch(`${app.base}users/42`, { headers: { 'x-abide-navigation': '1' } })
    expect(answered.headers.get('x-abide-navigation')).toBe('1')
    const fragment = await answered.text()

    const seeded = seedsIn(fragment)
    const key = seedKeyIn(seeded, 'users/getUser?')

    // The same answer the client would have fetched, which is the failure nothing else catches.
    const overTheWire = await (await fetch(`${app.base}__abide/rpc/users/getUser?id=42`)).json()
    expect(seeded[key]).toEqual(overTheWire)

    // FRAMED like every other piece, and last. The client cuts on the sentinel and parses what it
    // holds — a block written without one is markup appended to the piece before it, which lands in
    // the page as a stray element instead of in the seed table.
    expect(fragment.endsWith('<!--abide:piece-->')).toBe(true)
    expect(fragment.indexOf('abide-seed')).toBeGreaterThan(fragment.lastIndexOf('id="t'))

    // No nonce, and no need of one: the client parses this out of a `<template>` and reads its text,
    // so no element of it ever enters the document for a policy to evaluate.
    expect(/id="abide-seed" nonce=/.test(fragment)).toBe(false)
})

test('the no-scripts document seeds nothing, because nothing there could read it', async () => {
    // `renderDocumentToString` is the form for a reader that runs no scripts — mail, a PDF, a fixture
    // holding an expected document. There the markup is complete when the string is, so a data block
    // is bytes nobody parses, and the whole point of that form is that nothing is left to run.
    const answered = await fetch(`${app.base}__abide/rpc/users/getUser?id=7`)
    expect(answered.status).toBe(200)
    // An endpoint answering a fetch is not rendering a document either: nothing opened a table, so
    // there is nothing to record into and no key built to throw away.
    expect(await answered.text()).not.toContain('abide-seed')
})

test('the compressed head is on the wire before the slow panel settles', async () => {
    // A SOCKET rather than `fetch`, and that is the whole design of this case: Bun's fetch holds a
    // compressed body in its decoder until more of it arrives, so a decoded read cannot tell a
    // compressor that flushes per write from one that buffers to the end — which is the difference
    // between a browser painting the head immediately and painting it when the last panel lands.
    // What is timed here is the byte, not the character.
    const url = new URL(`${app.base}streaming?ms=${WAIT_MS}`)
    const started = performance.now()
    const at: number[] = []
    let wire = 0
    // Kept as well as counted, so the RESPONSE HEAD can come back out of the total below.
    const seen: Uint8Array[] = []
    const socket = await Bun.connect({
        hostname: url.hostname,
        port: Number(url.port),
        socket: {
            data(_handle, bytes) {
                at.push(performance.now() - started)
                wire += bytes.length
                seen.push(new Uint8Array(bytes))
            },
            open(handle) {
                handle.write(
                    `GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\n` +
                        `accept-encoding: gzip\r\nconnection: close\r\n\r\n`,
                )
            },
        },
    })
    try {
        // Long enough for the slow panel, which is what the early bytes have to beat.
        await Bun.sleep(WAIT_MS * 1.5)
    } finally {
        socket.end()
    }

    expect(at.length).toBeGreaterThan(1)
    // The claim: compressed bytes reached the wire well before the slow panel could have settled. A
    // compressor that buffered to the end would put every one of these at `WAIT_MS` or later.
    expect(at[0] as number).toBeLessThan(WAIT_MS * 0.5)
    // And the stream really did continue afterwards — the slow panel arrived in its own write rather
    // than the whole document having been small enough to land at once.
    expect(at[at.length - 1] as number).toBeGreaterThanOrEqual(WAIT_MS * 0.8)

    // The ratio, measured where it is real: a streamed response has no `content-length`, so the socket
    // is the only honest place to compare the wire form against the document it carries.
    //
    // The RESPONSE HEAD comes out of the total first, and that is not tidiness — headers do not
    // compress, so leaving them in makes this a claim about the size of the page rather than about the
    // compressor. It passed for a document with a twenty-link nav in it and failed the moment the nav
    // became three links: same compressor, same behaviour, 2334 bytes against a 3968-byte page.
    const all = new Uint8Array(wire)
    let at_ = 0
    for (const chunk of seen) {
        all.set(chunk, at_)
        at_ += chunk.length
    }
    const head = new TextDecoder().decode(all.subarray(0, Math.min(2048, all.length)))
    const bodyFrom = head.indexOf('\r\n\r\n') + 4
    expect(bodyFrom).toBeGreaterThan(4)
    const body = wire - bodyFrom

    const identity = await fetch(url, { headers: { 'accept-encoding': 'identity' } })
    const whole = (await identity.text()).length
    expect(body).toBeLessThan(whole / 2)
})

test('every response abide generates carries the headers it should', async () => {
    // One case over every SHAPE rather than an assertion bolted onto each of the cases above: what is
    // being claimed is a property of the funnel — `headersFor` is the one place all of these pass
    // through — so a shape added without going through it fails HERE, which is where a reader looks.
    const asset = Object.keys(manifest.assets)[0] as string
    const shapes: [string, string, Record<string, string>][] = [
        ['document', 'channel', {}],
        ['navigation', 'channel', { 'x-abide-navigation': '1' }],
        ['asset', `${CLIENT_ROUTE.slice(1)}${asset}`, {}],
        ['health', '__abide/health', {}],
        ['identity', '__abide/identity', {}],
        ['an rpc refusal', '__abide/rpc/nope/nope', {}],
    ]
    for (const [label, path, headers] of shapes) {
        const answered = await fetch(`${app.base}${path}`, { headers })
        // Never absent and never anything else: a browser guessing a type is the vulnerability, and
        // there is no response abide builds whose type it did not itself declare.
        expect([label, answered.headers.get('x-content-type-options')]).toEqual([label, 'nosniff'])
        // And every one of them says whether it may be kept. Absent is not neutral — it licenses a
        // shared cache to invent a freshness lifetime for an answer that may name who asked for it.
        expect([label, answered.headers.get('cache-control')]).not.toEqual([label, null])
    }
})

test('a rendered page is private by default, and a route that wants a CDN says so', async () => {
    const page = await fetch(`${app.base}docs/channel`)
    expect(page.headers.get('cache-control')).toBe('private, no-store')
    expect(page.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')

    // The bundle is the counter-example that proves it is a DEFAULT and not a rule: same process,
    // same funnel, and a year of `immutable` because those bytes are addressed by their own hash.
    const asset = Object.keys(manifest.assets)[0] as string
    const held = await fetch(`${app.base}${CLIENT_ROUTE.slice(1)}${asset}`)
    expect(held.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
})

test('the policy names the nonce the markup is stamped with', async () => {
    // `csp()` is on in this app's `app.ts`, so this is the real header a browser gets.
    const answered = await fetch(`${app.base}streaming?ms=50`)
    const policy = answered.headers.get('content-security-policy') as string
    expect(policy).toContain(`object-src 'none'`)
    expect(policy).toContain(`base-uri 'self'`)
    // No `unsafe-inline` for SCRIPT: the two inline scripts a document carries are abide's own and
    // both are stamped, which is the whole reason the nonce exists.
    expect(policy).not.toContain(`script-src 'self' 'unsafe-inline'`)

    const stamp = policy.match(/script-src[^;]*'nonce-([^']+)'/)?.[1]
    expect(stamp).toBeDefined()

    const markup = await answered.text()
    // Every inline script the document carries — `patchScript` plus one `$p(id)` per deferred subtree
    // — and every style block. An unstamped one is a panel that never swaps in.
    const inline = markup.match(/<script(?![^>]*src=)[^>]*>/g) ?? []
    expect(inline.length).toBeGreaterThan(1)
    for (const tag of inline) expect(tag).toContain(`nonce="${stamp}"`)
    for (const tag of markup.match(/<style[^>]*>/g) ?? []) expect(tag).toContain(`nonce="${stamp}"`)

    // Guessable is the one thing a nonce may not be.
    const second = await fetch(`${app.base}streaming?ms=50`)
    const other = (second.headers.get('content-security-policy') as string).match(/'nonce-([^']+)'/)?.[1]
    expect(other).not.toBe(stamp)
})

test('a nonce carrier is in the head even when the render had no scoped block', async () => {
    // What `adopt` reads on the client. A route whose scoped component arrives through `import()`
    // after hydration has no block of its OWN in the document, and without this it had nowhere to
    // take a nonce from — so its rules were refused and the component rendered unstyled.
    const markup = await (await fetch(`${app.base}streaming?ms=50`)).text()
    expect(markup).toContain('data-abide=""')
})
