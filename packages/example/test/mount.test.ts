// The same app, served under a sub-path — `APP_URL=…/v2`, and nothing else changed.
//
// Not a demo, for `start.test.ts`'s reason: a card cannot bind a socket or read what a bundler wrote.
// The half a card CAN make is in `demos/routing.ts` — `url`, `navigate` and the table, which is where
// the two spaces are stated. This is the other half, and it is the one that cannot be reasoned about
// from the router alone: a mount is only real if the page, the endpoints and the bundle all moved
// TOGETHER, and each of those is answered by a different layer.
//
// The claim: the app's SOURCE is unchanged. Its pages are still `/users/[id]`, its endpoints are still
// `demo/…`, and its `app.html` still names `./client.ts` — one environment variable moved every
// address the browser is given, and moved nothing the app calls things by.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { CLIENT_ROUTE, type ClientManifest, MANIFEST_FILE } from 'abide/cli'
import { abide, addressOf, BINARY, LISTENING, reading, type Running } from 'abide-kit/spawn'
import { EXAMPLE_ROOT as ROOT } from './root.ts'

/** The sub-path this app is mounted at for the length of this file. */
const BASE = '/v2'

let app: Running
let entry: string

beforeAll(async () => {
    const built = await abide(['build'], { cwd: ROOT })
    expect(built.code).toBe(0)
    const manifest = (await Bun.file(`${ROOT}/${MANIFEST_FILE}`).json()) as ClientManifest
    entry = manifest.entries['client.ts'] as string

    // Port `0` and a declared `APP_URL` together, which reads like a contradiction and is not: the
    // PORT is the kernel's to choose and the PATH is the operator's, and only the path is what a
    // mount is. `abide dev` corrects the origin of this variable after it binds and keeps the path,
    // which is the same split spelled at the other end.
    const child = reading(['bun', BINARY, 'start', '--port', '0'], {
        cwd: ROOT,
        env: { APP_URL: `http://localhost${BASE}` },
    })
    app = { ...child, base: addressOf(await child.until(LISTENING)) }
}, 30_000)

afterAll(() => {
    app?.child.kill('SIGKILL')
})

/** `http://127.0.0.1:PORT` — the address without the trailing slash `report` prints. */
function origin(): string {
    return new URL(app.base).origin
}

test('a page is served under the mount, and not at the root', async () => {
    const answered = await fetch(`${origin()}${BASE}/users/42`)
    expect(answered.status).toBe(200)
    const markup = await answered.text()
    // The app's own page, through its own layouts. The route is `/users/[id]` in the table either
    // way — a page under a mount is not a page that was renamed.
    expect(markup).toContain('<section class="users">')
    expect(markup).toContain('42')

    // The other half of the claim, and the one a passing render cannot make on its own: the app is
    // MOVED rather than also-at-the-root, so the un-mounted address is somebody else's to answer.
    const atRoot = await fetch(`${origin()}/users/42`)
    expect(atRoot.status).toBe(404)
})

test('the document points the browser at the mounted bundle', async () => {
    const markup = await (await fetch(`${origin()}${BASE}/users/42`)).text()

    // `app.html` names `./client.ts` and knows nothing about any of this. What it compiled to is read
    // from the manifest rather than guessed, exactly as `start.test.ts` does it.
    expect(markup).toContain(`<script type="module" src="${BASE}${CLIENT_ROUTE}${entry}">`)
    // And the raw prefix is nowhere in the document — a single un-mounted href is a 404 the page
    // renders around silently, which is precisely the failure this file exists to catch.
    expect(markup).not.toContain(`src="${CLIENT_ROUTE}`)
    expect(markup).not.toContain(`href="${CLIENT_ROUTE}`)

    // What the CLIENT reads the mount back out of. The bundle cannot carry it — it was built before
    // anyone chose one — so the document is the only thing that can say.
    expect(markup).toContain(`<meta name="abide-mount" content="${BASE}">`)
})

test('the bundle and the endpoints moved with it', async () => {
    const script = await fetch(`${origin()}${BASE}${CLIENT_ROUTE}${entry}`)
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toContain('text/javascript')

    // An endpoint under the mount, asked for by its APP-space id: `demo/…` is what the declaration
    // named and what a trace and a refusal say, wherever the app is served.
    const health = await fetch(`${origin()}${BASE}/__abide/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toHaveProperty('uptime')
})

test('the reserved prefix does not go on answering at the origin root', async () => {
    // The leak this is the gate for: `dispatch` stripping a mount that is not there would leave
    // `/__abide/**` served at BOTH addresses, so an app moved behind a proxy would still expose its
    // endpoints, its schema and its log feed at the root — mounted in the document and open beside it.
    for (const path of ['/__abide/health', '/__abide/schema', `${CLIENT_ROUTE}${entry}`]) {
        const answered = await fetch(`${origin()}${path}`)
        expect(answered.status).toBe(404)
    }
})
