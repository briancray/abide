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
import { abide, BINARY, ended, type Reading, EXAMPLE_ROOT as ROOT, reading, spawn } from './spawned.ts'

/** The app, plus the one thing a case needs that a live child does not carry: where it is listening. */
interface Running extends Reading {
    base: string
}

let app: Running
let manifest: ClientManifest
/** What `client.ts` compiled to, which is the only name that is not a guess. */
let entry: string

/**
 * Port `0` — the kernel's own spelling of "whatever is free", and what the printed URL then reports.
 *
 * A fixed port would make this file a test of what else is running on this machine. The one case that
 * NEEDS a fixed port is the one about a port being taken, and it takes one it holds itself.
 */
async function started(argv: string[], cwd = ROOT): Promise<Running> {
    const app = reading(['bun', BINARY, ...argv], { cwd })
    // The app's own `log()` lines come first — `onStart` runs before the socket exists — and the
    // report has a second line under the address, so every claim here is about a line that ARRIVES
    // rather than about a line number.
    const listening = await app.until('listening ')
    return { ...app, base: listening.slice('listening '.length).trim() }
}

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

test('a path that is no route is a 404, and a method that is no page falls through to one', async () => {
    const missing = await fetch(`${app.base}nowhere`)
    expect(missing.status).toBe(404)
    // The app returned `undefined` and `handle` decided what that meant, which is why an app never
    // writes a 404 of its own.
    expect(((await missing.json()) as { error: { name: string } }).error.name).toBe('AbideRouteError')

    const posted = await fetch(`${app.base}users/42`, { method: 'POST' })
    expect(posted.status).toBe(404)
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
    const user = await fetch(`${app.base}__abide/rpc/users/getUser?a=${encodeURIComponent('{"id":7}')}`)
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
    expect(inSlot).toContain('<h1>home</h1>')
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
    expect(await styles.text()).toContain('--ink')
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
