// 38.109 — `@abide/abide/test`, preloaded: an app's own test imports its `.abide` files and its
// handler files at the top of the file, as any module, with no `createApp` run first. Spawned as an
// author runs it — `bun test` in the app's directory, under the `bunfig.toml` the scaffold writes —
// because a preload is read when a run starts, and this run is already under happy-dom's.

import { afterAll, expect, test } from 'bun:test'

import { inAFreshProcess, spawned } from '@abide/harness/gate'

import { BUNFIG } from '#compiler/scaffold.ts'

import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

// A component and a handler file, and a test beside them under the subject's `tests` fence.
function app(bunfig: string | undefined): string {
    return temporaryModule({
        'package.json': JSON.stringify({
            name: 'preload-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        ...(bunfig === undefined ? {} : { 'bunfig.toml': bunfig }),
        'src/index.abide': '<main>home</main>',
        'src/media/lib/Badge.abide': `<script>
import { props } from '@abide/abide'

const { label } = props<{ label: string }>()
</script>

<span id="badge">{label}</span>`,
        'src/media/getThing.server.ts': `import { rpc } from '@abide/abide/server'

export default rpc(() => 'thing')
`,
        'src/media/signIn.server.ts': `import { principal } from '@abide/abide'
import { rpc } from '@abide/abide/server'

export default rpc(async () => {
    await principal.set({ id: 'ada' })
}, { methods: ['POST'] })
`,
        'src/media/tests/badge.test.ts': `import { expect, test } from 'bun:test'
import { createApp, render } from '@abide/abide/server'
import Badge from '../lib/Badge.abide'
import getThing from '../getThing.server.ts'

test('the component and the handler are the modules the app compiles', async () => {
    const html = new TextDecoder().decode(await render(Badge({ label: 'live' })))
    expect(html).toContain('<span id="badge">live</span>')
    expect(getThing.method).toBe('GET')
})

test('a sign-in seals with no secret the app declared', async () => {
    await using app = await createApp()
    const answer = await app.fetch(new Request('http://app.test/media/signIn', { method: 'POST' }))
    expect(answer.headers.getSetCookie().some((cookie) => cookie.startsWith('abide-principal='))).toBe(true)
})
`,
    })
}

// THE REVERT, which is the fixture without its preload: bun's own file loader answers the import with
// the file's path, and the same run fails on `Badge is not a function` — exit 1, `0 pass`.
//
// 38.120 — AND A SIGN-IN SEALS, though the fixture declares no `ABIDE_PRINCIPAL_SECRET`. THE REVERT:
// drop the secret from `preload.ts`; `principal.set` throws, the sign-in answers 500, and `1 pass`.
test('a test under the preload imports a .abide and a handler file of the app, and signs in — 38.109, 38.120', async () => {
    // Both runs at once: each is its own app and its own process.
    const [ran, unloaded] = await Promise.all([
        spawned(['bun', 'test', './src/media/tests/badge.test.ts'], {
            cwd: app(BUNFIG),
        }),
        spawned(['bun', 'test', './src/media/tests/badge.test.ts'], {
            cwd: app(undefined),
        }),
    ])
    expect(`${ran.exitCode} ${ran.stderr.includes('2 pass')}`, ran.stderr).toBe(
        '0 true',
    )
    expect(unloaded.exitCode).not.toBe(0)
    expect(unloaded.stderr).toContain('Badge is not a function')
}, 90_000)

// 38.119 — A COMPONENT MOUNTED IN A TEST, AND THE WORK A CLICK DOES: rendered as the server writes
// it, hydrated by its browser module, clicked, and counted. Spawned for the same reason as above,
// under the preload the scaffold writes: the harness's abide preload, a DOM ahead of abide's own. THE REVERT: drop `MOUNTABLE` from the bound
// face and `mount` throws "mount takes a component a test imported" — exit 1, `0 pass`.
test('a test mounts a component, clicks it and reads the work the click did — 38.119', async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'mount-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/lib/Counter.abide': `<script>
import { props, reactive } from '@abide/abide'

const { start } = props<{ start: number }>()
let count = reactive(start)
</script>

<p id="out">clicks: {count}</p>
<button id="more" onclick={() => (count = count + 1)}>more</button>`,
        'src/tests/Counter.test.ts': `import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import Counter from '../lib/Counter.abide'

test('a click rewrites the count and builds nothing', async () => {
    using _counter = await mount(Counter({ start: 2 }))
    expect(document.querySelector('#out')?.textContent).toBe('clicks: 2')
    const work = measure(() => {
        document.querySelector<HTMLButtonElement>('#more')?.click()
        flushSync()
    })
    expect(document.querySelector('#out')?.textContent).toBe('clicks: 3')
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(0)
    expect(work.dataWrites).toBe(1)
    expect(work.wakes).toBe(1)
})
`,
    })
    const ran = await spawned(['bun', 'test', './src/tests/Counter.test.ts'], {
        cwd,
    })
    expect(`${ran.exitCode} ${ran.stderr.includes('1 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 38.119 — TWO COMPONENTS MOUNTED TOGETHER EACH KEEP THEIR MARKUP: the second is rendered after the
// first rather than over it, so a click on the first still lands, and each one's stop takes away its
// own markup alone. THE REVERT: write the render over `document.body.innerHTML` again — the first
// tally is gone once the second mounts, `tallies: 1` where `2` is due — exit 1, `0 pass`.
test('two components mounted together each keep their markup, and stop removes its own — 38.119', async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'mount-together-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/lib/Tally.abide': `<script>
import { props, reactive } from '@abide/abide'

const { name } = props<{ name: string }>()
let count = reactive(0)
</script>

<button class="tally" data-name={name} onclick={() => (count = count + 1)}>{name}: {count}</button>`,
        'src/tests/Tally.test.ts': `import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import Tally from '../lib/Tally.abide'

const tallies = () => [...document.querySelectorAll('.tally')].map((one) => one.textContent)

test('both stand, and each stop removes its own', async () => {
    using _first = await mount(Tally({ name: 'calls' }))
    const second = await mount(Tally({ name: 'emails' }))
    expect(\`tallies: \${tallies().length}\`).toBe('tallies: 2')
    document.querySelector<HTMLButtonElement>('[data-name=calls]')?.click()
    flushSync()
    expect(tallies()).toEqual(['calls: 1', 'emails: 0'])
    second.stop()
    expect(tallies()).toEqual(['calls: 1'])
})
`,
    })
    const ran = await spawned(['bun', 'test', './src/tests/Tally.test.ts'], {
        cwd,
    })
    expect(`${ran.exitCode} ${ran.stderr.includes('1 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 38.134 — A PROP HANDED AS A GETTER IS LIVE: the mounted component reads it through the getter, so a
// test drives a read-only prop as a parent would, where a Reactive would bind it. THE REVERT: read
// `props[key]` once in `boundModule` whatever its descriptor; `#label` stays 'one still' where
// 'two still' is due — exit 1, `0 pass`.
test('a prop handed to a mounted component as a getter is read live — 38.134', async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'live-prop-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/lib/Label.abide': `<script>
import { props } from '@abide/abide'

const { label, fixed } = props<{ label: string; fixed: string }>()
</script>

<p id="label">{label} {fixed}</p>`,
        'src/tests/Label.test.ts': `import { expect, test } from 'bun:test'
import { flushSync, reactive } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import Label from '../lib/Label.abide'

test('the getter source moves the mounted label', async () => {
    const source = reactive('one')
    using _label = await mount(Label({ get label() { return source() }, fixed: 'still' }))
    expect(document.querySelector('#label')?.textContent).toBe('one still')
    source.set('two')
    flushSync()
    expect(document.querySelector('#label')?.textContent).toBe('two still')
})
`,
    })
    const ran = await spawned(['bun', 'test', './src/tests/Label.test.ts'], {
        cwd,
    })
    expect(`${ran.exitCode} ${ran.stderr.includes('1 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 38.207 — A PROP HANDED AS A `Reactive` IS BOUND TO IT, as a tag's `bind:` would be (32.6): the
// component reads it live and its write by name reaches the caller's value. THE REVERT: hand every
// prop to `boundModule`'s accessors as `() => value`; a prop the component only reads is then the
// `Reactive` itself, which has no `toUpperCase` — exit 1, `0 pass`. (One it writes adopts the
// `Reactive` either way, through its cell — 11.12.)
test('a prop handed to a mounted component as a Reactive is bound to it — 38.207', async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'bound-prop-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/lib/Echo.abide': `<script>
import { props } from '@abide/abide'

const { label, note } = props<{ label: string; note: string }>()
</script>

<p id="label">{label} {note.toUpperCase()}</p>
<button id="more" onclick={() => (label = label + '!')}>more</button>`,
        'src/tests/Echo.test.ts': `import { expect, test } from 'bun:test'
import { flushSync, reactive } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import Echo from '../lib/Echo.abide'

test('the caller reads what the component wrote, and the component what the caller set', async () => {
    const label = reactive('one')
    const note = reactive('a')
    using _echo = await mount(Echo({ label, note }))
    expect(document.querySelector('#label')?.textContent).toBe('one A')
    document.querySelector<HTMLButtonElement>('#more')?.click()
    flushSync()
    expect(label()).toBe('one!')
    label.set('two')
    note.set('b')
    flushSync()
    expect(document.querySelector('#label')?.textContent).toBe('two B')
})
`,
    })
    const ran = await spawned(['bun', 'test', './src/tests/Echo.test.ts'], {
        cwd,
    })
    expect(`${ran.exitCode} ${ran.stderr.includes('1 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 38.235 — A MOUNTED COMPONENT STANDS AT THE DOCUMENT'S ADDRESS, and navigates through a router the
// mount installs: its setup reads `route.url` in both halves — the server's without the fragment,
// which no request carries — and a push, a replace and a step land in `history`, where the test reads
// them back. THE REVERT: take `arrive` and `holdRouter` out of `testMount.ts`; the server pass's
// setup throws "a <script> setup read a value that has not landed" — exit 1, `0 pass`.
test('a mounted component reads route at the document address, and navigates — 38.235', async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'route-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/lib/Where.abide': `<script>
import { navigate, route } from '@abide/abide'

;(globalThis as { seen?: string[] }).seen?.push(route.url().href)
</script>

<p id="at">{route.url.pathname}{route.url.search}{route.url.hash} {route.index} {route.name}</p>
<button id="next" onclick={() => navigate('/next?page=2')}>next</button>
<button id="swap" onclick={() => navigate('/swapped', { replace: true })}>swap</button>`,
        'src/tests/Where.test.ts': `import { afterEach, expect, test } from 'bun:test'
import { navigate } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import Where from '../lib/Where.abide'

const at = () => document.querySelector('#at')?.textContent
const click = (id: string) => document.querySelector<HTMLButtonElement>(id)?.click()

afterEach(() => history.replaceState(null, '', '/'))

test('route is the address, and a navigation is the history', async () => {
    history.replaceState(null, '', '/start#key')
    const seen: string[] = []
    ;(globalThis as { seen?: string[] }).seen = seen
    {
        using _where = await mount(Where({}))
        expect(seen).toEqual([location.origin + '/start', location.origin + '/start#key'])
        expect(at()).toBe('/start#key 0 /start')
        const entries = history.length
        click('#next')
        expect(at()).toBe('/next?page=2 1 /next')
        expect(location.pathname + location.search).toBe('/next?page=2')
        expect(history.length).toBe(entries + 1)
        click('#swap')
        expect(at()).toBe('/swapped 1 /swapped')
        expect(history.length).toBe(entries + 1)
        await navigate(-1)
        expect(at()).toBe('/start#key 0 /start')
    }
    expect(await navigate('/after').catch((error: Error) => error.message)).toContain('no router')
})
`,
    })
    const ran = await spawned(['bun', 'test', './src/tests/Where.test.ts'], {
        cwd,
    })
    expect(`${ran.exitCode} ${ran.stderr.includes('1 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 38.235 — A MOUNTED PAGE RESOLVES THE ADDRESS AGAINST ITS OWN ROUTE: its params, and its route as
// the name. THE REVERT: drop `held.pages.set` from `addCompilation`; the page is read as a component
// — "invoice  at /invoices/7" where "invoice 7 at /invoices/[id]" is due.
test('a mounted page reads the params its route matches in the address — 38.235', async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'params-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/invoices/[id].abide': `<script>
import { route } from '@abide/abide'
</script>

<p id="invoice">invoice {route.params.id} at {route.name}</p>`,
        'src/invoices/tests/Invoice.test.ts': `import { expect, test } from 'bun:test'
import { mount } from '@abide/harness/abide'
import Invoice from '../[id].abide'

test('the params are the address', async () => {
    history.replaceState(null, '', '/invoices/7')
    using _invoice = await mount(Invoice({}))
    expect(document.querySelector('#invoice')?.textContent).toBe('invoice 7 at /invoices/[id]')
})
`,
    })
    const ran = await spawned(
        ['bun', 'test', './src/invoices/tests/Invoice.test.ts'],
        { cwd },
    )
    expect(`${ran.exitCode} ${ran.stderr.includes('1 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 38.236 — A TEST'S CALLS ARE ONE BROWSER'S SESSION: a sign-in one call makes is who the next call
// is, through a rung that reads the request. THE REVERT: have `within` read `STORAGE` alone again;
// the sign-in's `principal.set` throws "called outside a request" and the page reads `who: ` where
// `who: ada` is due — exit 1, `0 pass`.
//
// AND THE TEST SIGNS ITS SESSION IN as a call would, though the server pass resolved it through a
// rung. THE REVERT: have `SERVER_PRINCIPAL.document` reach the handler's entry outside every request
// too; that entry is one for the process, and keeps the test before's — "ada" where "grace" is due.
//
// AND THE NEXT TEST IS A FRESH BROWSER, signed out. THE REVERT: drop `forgetPrincipalMembers` from
// the preload's `beforeEach`; the members still hold the test before's — `true` where `false` is due.
//
// 38.204 — AND `settled` STILL SETTLES after the sign-in, though the derived values over the
// principal it set were left loading and nothing reads them. THE REVERT: drop `stalledUnread` from
// `pendingWork`; `settled` throws "4 still loading (derived, derived, derived, derived)".
test("a test's calls share one session, and a sign-in is the next call's — 38.236, 38.204", async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'session-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/account/signIn.server.ts': `import { principal } from '@abide/abide'
import { rpc } from '@abide/abide/server'

export default rpc(async () => {
    await principal.set({ id: 'ada' })
}, { methods: ['POST'] })
`,
        'src/account/whoAmI.server.ts': `import { principal } from '@abide/abide'
import { rpc, signedIn } from '@abide/abide/server'

export default rpc(async () => String((await principal.resolved).id), {
    methods: ['POST'],
    middleware: [signedIn],
})
`,
        'src/account/lib/Account.abide': `<script>
import { reactive } from '@abide/abide'

import signIn from '../signIn.server.ts'
import whoAmI from '../whoAmI.server.ts'

let who = reactive('')
</script>

<button id="in" onclick={() => signIn()}>sign in</button>
<button id="who" onclick={async () => (who = await whoAmI())}>who</button>
<p id="out">who: {who}</p>`,
        'src/layout.abide': `<script server>
import { onPrincipal } from '@abide/abide/server'

onPrincipal(async (claims) => ({ id: (claims as { id: string }).id }))
</script>

<slot />`,
        'src/account/mine.server.ts': `import { authorize, rpc } from '@abide/abide/server'

export default rpc(() => 'mine', { middleware: [authorize((who) => who.authenticated)] })
`,
        'src/account/lib/Mine.abide': `<script>
import { reactive } from '@abide/abide'

import mine from '../mine.server.ts'

const answer = reactive(() => mine())
</script>

{#try}<p>{answer}</p>{:catch}<p>refused</p>{/try}`,
        'src/account/tests/Account.test.ts': `import { expect, test } from 'bun:test'
import { principal } from '@abide/abide'
import { createApp } from '@abide/abide/server'
import { mount, settled } from '@abide/harness/abide'
import Account from '../lib/Account.abide'
import Mine from '../lib/Mine.abide'

const click = (id: string) => document.querySelector<HTMLButtonElement>(id)?.click()

test('signed in by one call, the next is the member', async () => {
    await using _app = await createApp()
    using _account = await mount(Account({}))
    click('#in')
    await settled()
    click('#who')
    await settled()
    expect(document.querySelector('#out')?.textContent).toBe('who: ada')
})

test('the test signs the session in as a call would', async () => {
    using _mine = await mount(Mine({}))
    await principal.set({ id: 'grace' })
    expect(String((await principal.resolved).id)).toBe('grace')
})

test('the next test is a fresh browser, signed out', async () => {
    expect(await principal.authenticated).toBe(false)
})
`,
    })
    const ran = await spawned(
        ['bun', 'test', './src/account/tests/Account.test.ts'],
        { cwd },
    )
    expect(`${ran.exitCode} ${ran.stderr.includes('3 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 12.5, 38.119 — THE SERVER PASS'S WATCH STOPS WITH IT. `mount` renders as a request does, and a
// request's scope is torn down once its document is written: the watch the render opened runs its
// disposer, and the one the hydration opened is the only one left live — until `stop` ends it too.
// THE REVERT: have `serverStops` answer a request's stops alone; the server pass's watch is owned by
// nothing, its listener stays on `window` beside the hydration's and outlives `stop` — "2 3", exit 1,
// `0 pass`. The server pass is torn down BEFORE the hydration, and a streamed `GET` the two share is
// started again by the hydration's read (12.14) — crm-05's `ActivityHistory` is the case.
test("a mounted component's server-pass watch is torn down with the render — 12.5, 38.119", async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'watch-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/lib/Analytics.abide': `<script>
import { watch } from '@abide/abide'

watch(() => {
    const heard = (): void => {
        ;(globalThis as { heard?: number }).heard = ((globalThis as { heard?: number }).heard ?? 0) + 1
    }
    window.addEventListener('identify', heard)
    return () => window.removeEventListener('identify', heard)
})
</script>

<p>analytics</p>`,
        'src/tests/Analytics.test.ts': `import { expect, test } from 'bun:test'
import { mount } from '@abide/harness/abide'
import Analytics from '../lib/Analytics.abide'

test('one listener is live while mounted, and none once stopped', async () => {
    const analytics = await mount(Analytics({}))
    window.dispatchEvent(new Event('identify'))
    const mounted = (globalThis as { heard?: number }).heard
    analytics.stop()
    window.dispatchEvent(new Event('identify'))
    expect(\`\${mounted} \${(globalThis as { heard?: number }).heard}\`).toBe('1 1')
})
`,
    })
    const ran = await spawned(
        ['bun', 'test', './src/tests/Analytics.test.ts'],
        {
            cwd,
        },
    )
    expect(`${ran.exitCode} ${ran.stderr.includes('1 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 38.133 — EACH TEST FILE STARTS COLD: one file settles a handler's answer, and the next file in the
// same process mounts a component calling it and still finds it unanswered, then answered. The two
// files are named on the command line, which is the order `bun test` runs them in — the order a
// Linux runner happened to choose is what found it. THE REVERT: drop the `invalidate()` from the
// preload's `beforeEach`; the cold file reads `1` at mount where `0` is due — exit 1, `1 pass`.
test('a test file finds no answer an earlier file settled — 38.133', async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'cold-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/things/listThings.server.ts': `import { rpc } from '@abide/abide/server'

export default rpc(async () => {
    await Bun.sleep(100)
    return ['thing']
})
`,
        'src/things/lib/Things.abide': `<script>
import { reactive } from '@abide/abide'

import listThings from '../listThings.server.ts'

const things = reactive(() => listThings())
</script>

<ul>
    {#for thing of things}
        <li>{thing}</li>
    {/for}
</ul>`,
        'src/things/tests/settles.test.ts': `import { expect, test } from 'bun:test'
import { mount } from '@abide/harness/abide'
import Things from '../lib/Things.abide'

test('the answer settles', async () => {
    using _things = await mount(Things({}))
    await Bun.sleep(300)
    expect(document.querySelectorAll('li').length).toBe(1)
})
`,
        'src/things/tests/cold.test.ts': `import { expect, test } from 'bun:test'
import { mount } from '@abide/harness/abide'
import Things from '../lib/Things.abide'

test('the next file waits for its own answer', async () => {
    using _things = await mount(Things({}))
    expect(document.querySelectorAll('li').length).toBe(0)
    await Bun.sleep(300)
    expect(document.querySelectorAll('li').length).toBe(1)
})
`,
    })
    const ran = await spawned(
        [
            'bun',
            'test',
            './src/things/tests/settles.test.ts',
            './src/things/tests/cold.test.ts',
        ],
        { cwd },
    )
    expect(`${ran.exitCode} ${ran.stderr.includes('2 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 38.119 — A MOUNTED COMPONENT'S DYNAMIC `import('#src/…')` resolves as its static one does: from the
// file its browser module stands for, not from the namespace that module is loaded in. THE REVERT:
// narrow the runtime's hook in `abideModules` back to relative specifiers, and the click reads "ERR
// ResolveMessage: Cannot find package '#src' imported from /abide-client:/…/Dynamic.abide::client" —
// exit 1, `0 pass`.
test('a mounted component imports a #src module dynamically — 38.119', async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'dynamic-fixture',
            type: 'module',
            imports: { '#src/*': ['./src/*', './src/*.ts'] },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/lib/word.ts': "export const word = 'loaded'\n",
        'src/lib/Dynamic.abide': `<script>
import { reactive } from '@abide/abide'

let out = reactive('none')
const load = async () => {
    try {
        out = (await import('#src/lib/word.ts')).word
    } catch (thrown) {
        out = \`ERR \${thrown}\`
    }
}
</script>

<button id="load" onclick={load}>load</button>
<p id="out">{out}</p>`,
        'src/tests/Dynamic.test.ts': `import { expect, test } from 'bun:test'
import { mount } from '@abide/harness/abide'
import Dynamic from '../lib/Dynamic.abide'

test('the click loads the module', async () => {
    using _dynamic = await mount(Dynamic({}))
    document.querySelector<HTMLButtonElement>('#load')?.click()
    for (let tries = 0; tries < 100 && document.querySelector('#out')?.textContent === 'none'; tries += 1)
        await Bun.sleep(10)
    expect(document.querySelector('#out')?.textContent).toBe('loaded')
})
`,
    })
    const ran = await spawned(['bun', 'test', './src/tests/Dynamic.test.ts'], {
        cwd,
    })
    expect(`${ran.exitCode} ${ran.stderr.includes('1 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 38.121 — A MOUNTED COMPONENT'S CALL TO ITS PRIVATE HANDLER, made by its browser module on a click,
// is answered by the value its server block exports — the same one the render read — each click
// with the args it asked with. THE REVERT: load the browser module's `client` as compiled, wrappers and all, and each call
// fetches `/abide-client:/…/src/handlers/lib/Private/bump`, which nothing answers — the click reads
// "ERR HttpError: Service Unavailable", exit 1, `0 pass`.
test('a mounted component calls its private handler from a click — 38.121', async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'private-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/lib/Private.abide': `<script server>
export const bump = ({ n }: { n: number }) => n * 10
export const greet = () => 'hi'
</script>

<script>
import { reactive } from '@abide/abide'

let out = reactive('none')
let pressedTimes = 0
const greeting = reactive(() => greet())
const press = async () => {
    pressedTimes += 1
    try {
        out = String(await bump({ n: pressedTimes }))
    } catch (thrown) {
        out = \`ERR \${thrown}\`
    }
}
</script>

<p id="greeting">{greeting}</p>
<button id="bump" onclick={press}>bump</button>
<p id="out">{out}</p>`,
        'src/tests/Private.test.ts': `import { expect, test } from 'bun:test'
import { mount } from '@abide/harness/abide'
import Private from '../lib/Private.abide'

async function pressed(was: string | null | undefined): Promise<string | null | undefined> {
    document.querySelector<HTMLButtonElement>('#bump')?.click()
    for (let tries = 0; tries < 100 && document.querySelector('#out')?.textContent === was; tries += 1)
        await Bun.sleep(10)
    return document.querySelector('#out')?.textContent
}

test('each click is answered by the handler', async () => {
    using _private = await mount(Private({}))
    expect(document.querySelector('#greeting')?.textContent).toBe('hi')
    expect(await pressed('none')).toBe('10')
    expect(await pressed('10')).toBe('20')
})
`,
    })
    const ran = await spawned(['bun', 'test', './src/tests/Private.test.ts'], {
        cwd,
    })
    expect(`${ran.exitCode} ${ran.stderr.includes('1 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 15.8, 19.9 — A CALL MADE IN THE TEST'S PROCESS IS HELD TO THE ANNOTATION, with no app booted: a
// handler file the test imports, and a private handler a mounted component calls (38.121), each
// refused 422 with the `Issues` the wire answers with, its body never run, and good args answered.
// THE REVERT: `normalized` for `acceptedArgs` in the `Rpc`'s call in `rpc.ts`; the handler file's body
// runs on `n: 'x'` and nothing is refused ("undefined undefined undefined runs 1"), and the private
// handler's click reads "1x" — exit 1, `0 pass`.
test('a call in a test is held to the handler annotation — 15.8, 19.9, 38.121', async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'annotated-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/tally.server.ts': `import { rpc } from '@abide/abide/server'

const runs = globalThis as { tallied?: number }

export default rpc(({ id, n }: { id: number; n: number }) => {
    runs.tallied = (runs.tallied ?? 0) + 1
    return id + n
}, { methods: ['POST'] })
`,
        'src/lib/Form.abide': `<script server>
let saved = 0
export const save = ({ n }: { n: number }) => ++saved + n
</script>

<script>
import { reactive } from '@abide/abide'

let out = reactive('none')
const send = async (n: unknown) => {
    try {
        out = String(await save({ n: n as never }))
    } catch (thrown) {
        const refused = thrown as { name: string; status: number; data: unknown }
        out = \`\${refused.name} \${refused.status} \${JSON.stringify(refused.data)}\`
    }
}
</script>

<button id="bad" onclick={() => send('x')}>bad</button>
<button id="good" onclick={() => send(10)}>good</button>
<p id="out">{out}</p>`,
        'src/tests/annotated.test.ts': `import { expect, test } from 'bun:test'
import { mount } from '@abide/harness/abide'
import Form from '../lib/Form.abide'
import tally from '../tally.server.ts'

const runs = globalThis as { tallied?: number }
const REFUSED = 'ValidationError 422 {"n":["must be number, was string"]}'

test('a handler file the test imports', async () => {
    let refused: { name?: string; status?: number; data?: unknown } = {}
    try {
        await tally({ id: 1, n: 'x' as never })
    } catch (thrown) {
        refused = thrown as typeof refused
    }
    expect(\`\${refused.name} \${refused.status} \${JSON.stringify(refused.data)} runs \${runs.tallied ?? 0}\`).toBe(\`\${REFUSED} runs 0\`)
    expect(await tally({ id: 1, n: 2 })).toBe(3)
    expect(runs.tallied).toBe(1)
})

async function pressed(id: string, was: string | null | undefined): Promise<string | null | undefined> {
    document.querySelector<HTMLButtonElement>(id)?.click()
    for (let tries = 0; tries < 100 && document.querySelector('#out')?.textContent === was; tries += 1)
        await Bun.sleep(10)
    return document.querySelector('#out')?.textContent
}

test('a private handler a mounted component calls', async () => {
    using _form = await mount(Form({}))
    expect(await pressed('#bad', 'none')).toBe(REFUSED)
    // The first save's count: the refused call never ran the body.
    expect(await pressed('#good', REFUSED)).toBe('11')
})
`,
    })
    const ran = await spawned(
        ['bun', 'test', './src/tests/annotated.test.ts'],
        {
            cwd,
        },
    )
    expect(`${ran.exitCode} ${ran.stderr.includes('2 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 38.204 — A TEST AWAITS `settled` AFTER A CLICK, and reads the page as the call left it: a click's
// handler awaits a slow call and writes what it answered. 38.205 — AND A CALL THAT NEVER ANSWERS IS
// NAMED by the time `settled` gives up. THE REVERT: drop `keepLoads()` from `preload.ts`; nothing is
// kept, `settled` resolves on its first turn, the page still reads "none" and the hung call is never
// named — exit 1, `0 pass`. Drop `nameLoad` from the `Rpc`'s call in `rpc.ts` and the hung call is
// named "(reactive)" — `1 pass`. And each test waits on its own: drop `keepLoads()` from the
// `beforeEach` in `preload.ts` and the click waits on the hung call too, "1 still loading" — `1 pass`.
test('settled waits out a call a click made, and names one that never answers — 38.204, 38.205', async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'settled-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': BUNFIG,
        'src/index.abide': '<main>home</main>',
        'src/lib/Slow.abide': `<script server>
export const save = async () => {
    await Bun.sleep(150)
    return 'saved'
}
export const hang = () => new Promise<string>(() => {})
</script>

<script>
import { reactive } from '@abide/abide'

let out = reactive('none')
const press = async () => {
    out = await save()
}
const stall = () => {
    hang()
}
</script>

<button id="save" onclick={press}>save</button>
<button id="hang" onclick={stall}>hang</button>
<p id="out">{out}</p>`,
        'src/tests/Slow.test.ts': `import { expect, test } from 'bun:test'
import { mount, settled } from '@abide/harness/abide'
import Slow from '../lib/Slow.abide'

test('a call that never answers is named', async () => {
    using _slow = await mount(Slow({}))
    document.querySelector<HTMLButtonElement>('#hang')?.click()
    let named = ''
    try {
        await settled({ timeout: 200 })
    } catch (thrown) {
        named = String(thrown)
    }
    expect(named).toContain('settled() waited 200 ms and 1 still loading (GET ')
})

test('a click is settled, past the call the test above left hanging', async () => {
    using _slow = await mount(Slow({}))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await settled()
    expect(document.querySelector('#out')?.textContent).toBe('saved')
})
`,
    })
    const ran = await spawned(['bun', 'test', './src/tests/Slow.test.ts'], {
        cwd,
    })
    expect(`${ran.exitCode} ${ran.stderr.includes('2 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 38.206 — NOTHING IS KEPT FOR `settled` WHERE THE TEST ENTRY NEVER LOADED: a page or a server keeps
// no list of the values that went loading. Taken in a child, since this process loaded the entry.
// THE REVERT: call `keepLoads()` where `Reactive.ts` declares it; this reports `["memo"]`.
test('a process that never loaded @abide/abide/test keeps no load — 38.206', async () => {
    const run = await inAFreshProcess(`
import { memo, reactive } from '${import.meta.dir}/../src/shared/reactive/index.ts'
import { pendingWork } from '${import.meta.dir}/../src/shared/reactive/producer.ts'

const waiting = reactive(() => new Promise(() => {}))
waiting.busy()
console.log(JSON.stringify(pendingWork().loading))
`)
    expect(run.output.trim()).toBe('[]')
})
