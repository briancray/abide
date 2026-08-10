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
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { CLIENT_ROUTE, type ClientManifest, MANIFEST_FILE } from 'abide/cli'
import { abide, BINARY, ended, EXAMPLE_ROOT as ROOT, type Running, spawn, started } from './spawned.ts'

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
    app = await started(['start', '--port', '0'])
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
    expect(answered.headers.get('x-example')).toBe('served')
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
    expect(answered.headers.get('x-example')).toBe('served')

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
 * is asserted where it belongs: `a streamed document compresses without being held back`, below,
 * reads the socket rather than a decoded body. Asking for identity here keeps the two apart, so a
 * change to either one fails the test that is about it.
 */
async function chunks(path: string, headers: Record<string, string> = {}): Promise<Timed[]> {
    const started = performance.now()
    const answered = await fetch(`${app.base}${path}`, { headers: { ...headers, 'accept-encoding': 'identity' } })
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
    // This one is the APP's: `pages/[suite]/` is one page for twenty suites, and a parameter matches
    // anything — so the only half of this app that knows `/nowhere` is not a suite is `app.ts`, which
    // is asked before the pages and answers it.
    const missing = await fetch(`${app.base}nowhere`)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('no suite named nowhere')

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
    expect(compressed.headers.get('x-example')).toBeNull()

    // Bun's fetch decodes what it accepted, so the bytes it hands back are the module either way —
    // and what is IN them is the address, which is the elision the build test asserts in full.
    expect(await compressed.text()).toContain('users/getUser')

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
    // The hub, rendered: its heading and one card per case of the overview suite. Server-rendered
    // with no case having RUN — a case needs a live area, and a live area needs a browser.
    expect(inSlot).toContain('>abide<')
    expect(inSlot).toContain('<section')
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
    // The app's OWN rule, not just the framework the plugin generated around it: `body` is what
    // `app.css` writes under the `@import "tailwindcss"`, so finding it proves the file the page
    // imported went through the plugin this app declared in its bunfig and came out the other side.
    const text = await styles.text()
    expect(text).toContain('var(--color-slate-900)')
    expect(text).toContain('-webkit-font-smoothing:antialiased')
})

test('SIGTERM drains through the app’s onStop and closes the socket', async () => {
    // Its OWN process, named apart from the module-level `app` every other case fetches against —
    // this one is signalled, and a shadowed name would make `app.base` mean two things in one file.
    const doomed = await started(['start', '--port', '0'])
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
    // anything else running.
    const holder = Bun.serve({ port: 0, fetch: () => new Response('mine') })
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

test('a directory with no app, and a client lane with no build, both refuse', async () => {
    const empty = await mkdtemp(`${tmpdir()}/abide-start-`)
    try {
        const nothing = await abide(['start'], { cwd: empty })
        expect(nothing.code).toBe(2)
        expect(nothing.err).toContain('no app here')

        // The one shape that is unambiguously a mistake: the lane is written and the bundle is not
        // there, so every `<script>` the pages emit would 404. Refused before anything binds, and
        // the message is the command that fixes it.
        await Bun.write(`${empty}/app.ts`, 'export default (): undefined => undefined\n')
        await Bun.write(`${empty}/client.ts`, 'console.log("hydrate")\n')
        const unbuilt = await abide(['start'], { cwd: empty })
        expect(unbuilt.code).toBe(1)
        expect(unbuilt.err).toContain('run `abide build`')

        // And the shape that is NOT a mistake: no client lane, and a module that exports no route at
        // all. That is an app made of endpoints, and it comes up — `/__abide/**` is served without
        // the app mounting anything, which is the whole reason this is allowed to start.
        await rm(`${empty}/client.ts`)
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
    const socket = await Bun.connect({
        hostname: url.hostname,
        port: Number(url.port),
        socket: {
            data(_handle, bytes) {
                at.push(performance.now() - started)
                wire += bytes.length
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

    // The ratio, measured where it is real: `wire` is every byte the socket saw, headers and chunked
    // framing included, against the document those bytes carry. A streamed response has no
    // `content-length`, so this is the only honest place to compare the two.
    const identity = await fetch(url, { headers: { 'accept-encoding': 'identity' } })
    const whole = (await identity.text()).length
    expect(wire).toBeLessThan(whole / 2)
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
    const page = await fetch(`${app.base}channel`)
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
