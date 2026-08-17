// One origin, two apps: the front door, and the isolation it exists to buy.
//
// A demo that is a real app needs somewhere to BE. `mount.ts` says a sub-path mount is a proxy
// forwarding one prefix, and until `harness/fleet.ts` there was no such proxy in dev or under test —
// so a "demo app" could only ever be a string written into a frame, which is the one thing that
// cannot run its own scripts (see `internal/frame.ts`).
//
// `perf` is the app behind the prefix here rather than a fixture invented for the test, and that is
// the point of the last claim: its shell ships NO stylesheet, deliberately, because one CSS rule was
// the whole of a "4.5x faster" reading once. Mounted under a prefix inside another origin, it has to
// STILL ship none — an app that inherited the host's stylesheet by being mounted would be measuring
// the host. Nothing but a real second app can make that claim, which is why this is the gate for the
// fleet rather than a test of a proxy.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { frontDoor } from 'harness/fleet'
import { BINARY, LISTENING, readLines, spawn } from 'harness/spawn'
import { APPS } from '#shared/demos/APPS.ts'
import { APP_ROOT } from '#tests/PATHS.ts'

/** Fixed and deliberate. Ports that hop on collision make a fleet impossible to reason about. */
const DOOR = 4341
const PERF = 4342
const ROOT = 4343
const PREFIX = '/demo/perf'

// In `beforeAll` rather than at module scope, and that is not a style preference: `bun test` imports
// every file before running any of them, so a child spawned out here is a second app building and
// serving for the WHOLE session — competing for the CPU that the timing-sensitive cases in
// `cli.test.ts` and `lifecycle.test.ts` are measuring against. Scoped here, it lives for this file.
let root: ReturnType<typeof Bun.serve>
let child: ReturnType<typeof spawn>
let door: ReturnType<typeof frontDoor>

beforeAll(async () => {
    /** A stand-in for whatever is at the root. The claim here is the PREFIX, not what is behind `/`. */
    root = Bun.serve({
        port: ROOT,
        fetch: () => new Response('<!doctype html><title>the root app</title>', { headers: { 'content-type': 'text/html' } }),
    })

    child = spawn([BINARY, 'dev', '--port', String(PERF)], {
        // A PATH, not a URL: `import.meta.dir` is already one, and handing it to `new URL` throws.
        cwd: `${APP_ROOT}/../perf`,
        // Where it was told it lives. Everything it serves and every href it writes carries this.
        env: { ...process.env, APP_URL: `http://localhost:${DOOR}${PREFIX}` },
    })

    // Waited for, so a slow first build is not read as a broken door.
    for await (const line of readLines(child.stdout)) if (line.includes(LISTENING)) break

    door = frontDoor(DOOR, [{ prefix: PREFIX, port: PERF }], ROOT)
})

afterAll(() => {
    door.stop()
    child.kill()
    root.stop(true)
})

test('everything outside the prefix goes to the root', async () => {
    const answered = await fetch(`${door.url}/`)
    expect(answered.status).toBe(200)
    expect(await answered.text()).toContain('the root app')
})

test('the prefix reaches the app that was told it lives there', async () => {
    const answered = await fetch(`${door.url}${PREFIX}/`)
    expect(answered.status, 'the mounted app did not answer through the door').toBe(200)
    const html = await answered.text()
    // Its own document, not the root's — the title is the cheapest thing that cannot be both.
    expect(html, 'the door served the wrong app').toContain('abide perf')
})

test('a mounted app addresses ITSELF under the prefix', async () => {
    // The claim `mount.ts` makes: app space never carries the base, browser space always does. So the
    // document it serves has to point at its own bundle THROUGH the prefix, or the page loads nothing.
    const html = await (await fetch(`${door.url}${PREFIX}/`)).text()
    const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(script, 'the client entry is not addressed under the mount').toStartWith(`${PREFIX}/`)

    const bundle = await fetch(`${door.url}${script}`)
    expect(bundle.status, 'the bundle the document names is not reachable through the door').toBe(200)
})

test('a mounted app writes its own LINKS under the prefix too', async () => {
    // Found by mounting rather than reasoned about: `packages/perf` wrote `<a href="/dashboard">` as a
    // literal, so served under a sub-path every link in its nav left the app. App space never carries
    // the base and browser space always does, and `url()` is the one crossing between them — the same
    // target `navigate` builds, so a link and a navigation cannot disagree about where they go.
    const html = await (await fetch(`${door.url}${PREFIX}/`)).text()
    const hrefs = Array.from(html.matchAll(/<a href="([^"]*)"/g), (found) => found[1] ?? '')
    expect(hrefs.length, 'no links to check — the nav did not render').toBeGreaterThan(0)
    const escaping = hrefs.filter((href) => !href.startsWith(PREFIX))
    expect(escaping, 'a link that leaves the app it belongs to').toEqual([])
})

test('the page frames an entry the app actually serves', async () => {
    // `/demos` frames `prefix + entry` and `site.test.ts` gates that the page and the list agree. What
    // neither can see is whether that entry is a ROUTE: both sides agree perfectly about an address
    // nothing answers on, and it renders as an empty box rather than as anything diagnosable.
    const perf = APPS.find((app) => app.name === 'perf')
    expect(perf, 'the fleet list lost the app this file boots').toBeDefined()

    const answered = await fetch(`${door.url}${PREFIX}${perf?.entry ?? ''}`)
    expect(answered.status, `${perf?.entry} is framed on /demos but not served`).toBe(200)
})

test('mounted inside another origin, it still ships no stylesheet', async () => {
    // The whole reason a demo is its own app. `packages/perf/app.html` names no stylesheet on purpose:
    // Blink builds its style invalidation sets from the sheets, so a class no rule mentions costs
    // nothing after the write — and the one arm that shipped CSS read as 4.5x slower for it. Being
    // mounted must not change that; a demo that inherited the host's sheet would measure the host.
    const html = await (await fetch(`${door.url}${PREFIX}/`)).text()
    expect(html, 'the mounted app grew a stylesheet').not.toContain('<link rel="stylesheet"')

    // The RULES, not the tag. Abide writes one empty `<style data-abide>` into every document as the
    // place a component's scoped styles land, and an app with no scoped styles ships it empty — which
    // is a `<style>` in the markup and no CSS at all. Asserting on the tag called that a stylesheet.
    const blocks = Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g), (found) => found[1] ?? '')
    const rules = blocks.join('').trim()
    expect(rules, `the mounted app grew ${rules.length} characters of CSS`).toBe('')
})
