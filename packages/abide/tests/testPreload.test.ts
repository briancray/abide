// 38.109 — `@abide/abide/test`, preloaded: an app's own test imports its `.abide` files and its
// handler files at the top of the file, as any module, with no `createApp` run first. Spawned as an
// author runs it — `bun test` in the app's directory, under the `bunfig.toml` the scaffold writes —
// because a preload is read when a run starts, and this run is already under happy-dom's.

import { afterAll, expect, test } from 'bun:test'
import { spawned } from '@abide/harness/gate'
import { TEST_PRELOAD } from '#compiler/scaffold.ts'
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
        'src/media/getThing.ts': `import { GET } from '@abide/abide/server'

export default GET(() => 'thing')
`,
        'src/media/signIn.ts': `import { principal } from '@abide/abide'
import { POST } from '@abide/abide/server'

export default POST(async () => {
    await principal.set({ id: 'ada' })
})
`,
        'src/media/tests/badge.test.ts': `import { expect, test } from 'bun:test'
import { createApp, render } from '@abide/abide/server'
import Badge from '../lib/Badge.abide'
import getThing from '../getThing.ts'

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
            cwd: app(TEST_PRELOAD),
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
        'bunfig.toml': TEST_PRELOAD,
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
        'bunfig.toml': TEST_PRELOAD,
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
// is answered by the handler: the same one the render read, so a second click counts on from the
// first. THE REVERT: load the browser module's `client` as compiled, wrappers and all, and each call
// fetches `/abide-client:/…/src/handlers/lib/Private/bump`, which nothing answers — the click reads
// "ERR HttpError: Service Unavailable", exit 1, `0 pass`.
test('a mounted component calls its private handler from a click — 38.121', async () => {
    const cwd = temporaryModule({
        'package.json': JSON.stringify({
            name: 'private-fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'bunfig.toml': TEST_PRELOAD,
        'src/index.abide': '<main>home</main>',
        'src/lib/Private.abide': `<script server>
import { GET, POST } from '@abide/abide/server'

let count = 0
const bump = POST(() => ++count)
const greet = GET(() => 'hi')
</script>

<script>
import { reactive } from '@abide/abide'

let out = reactive('none')
const greeting = reactive(() => greet())
const press = async () => {
    try {
        out = String(await bump())
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
    expect(await pressed('none')).toBe('1')
    expect(await pressed('1')).toBe('2')
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
