// 38.71-38.75, 38.80-38.81, 38.101-38.102, 38.107 — the desktop launcher's session, options, accent
// and own page, apart from the window: none of the four needs one to be checked.
//
// THE REVERT, for the accent: average every opaque pixel instead of binning by hue, and dogfood's
// icon reads as a gray-green near its ground rather than the teal of its mark.

import { afterAll, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises' // bun exposes no directory removal of its own
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import { buildDirectory, servedBuild } from '#server/appBuild.ts'
import type { App } from '#server/createApp.ts'
import { DesktopSession } from '#server/DesktopSession.ts'
import { HOOKS } from '#server/hooks.ts'
import { iconAccent, inkOn } from '#server/iconAccent.ts'
import { type Launcher, launcherOf } from '#server/launcherOptions.ts'
import { type Launch, launcherPage } from '#server/launcherPage.ts'
import { LISTENING } from '#server/requestScope.ts'
import { LAUNCHER_PAGE } from '#shared/LAUNCHER_FILES.ts'

import { appFixture, buildApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

const DOGFOOD_ICON = new URL(
    '../../dogfood/src/public/icon.png',
    import.meta.url,
)

test('the accent is the icon mark’s hue, not its ground’s — 38.101', async () => {
    const accent = iconAccent(await Bun.file(DOGFOOD_ICON).bytes())
    expect(accent).toBeDefined()
    const red = Number.parseInt((accent as string).slice(1, 3), 16)
    const green = Number.parseInt((accent as string).slice(3, 5), 16)
    const blue = Number.parseInt((accent as string).slice(5, 7), 16)
    // Teal: green and blue well above red.
    expect(green - red).toBeGreaterThan(80)
    expect(blue - red).toBeGreaterThan(60)
    expect(inkOn(accent as string)).toBe('#ffffff')
})

test('an image that is not a PNG gives no accent', () => {
    expect(iconAccent(new Uint8Array([1, 2, 3]))).toBeUndefined()
})

test('what onLauncher answers fills its defaults and refuses what it does not take — 38.80, 38.81', () => {
    expect(launcherOf({ width: 960 })).toMatchObject({
        width: 960,
        height: 760,
        start: true,
        connect: true,
    })
    expect(launcherOf({ name: 'Ledger' })).toContain(
        '`name` is not a launcher option',
    )
    expect(launcherOf({ start: false, connect: false })).toContain(
        'both start and connect',
    )
})

// 38.80 — THE `onLauncher` `launcher.abide`'s SERVER BLOCK CALLS IS WHAT THE LAUNCH READS: the file is
// imported out of the build as `runDesktop` imports it, and the last one filed is the answer read.
// THE REVERT: have `onLauncher` file nothing (`return () => {}` in `hooks.ts`); importing the file
// files 0 where 1 is due, and the launch would read the default width, 1100, where 1200 is due.
test('the launch reads what launcher.abide files with onLauncher — 38.80', async () => {
    const app = appFixture({
        'index.abide': '<main>home</main>',
        'launcher.abide': `<script server>
import { onLauncher } from '@abide/abide/server'

onLauncher(() => ({ width: 1200 }))
</script>
`,
    })
    const built = await buildApp(app)
    expect(built.exitCode, built.stderr).toBe(0)
    const before = HOOKS.launcher.length
    await servedBuild(app, buildDirectory(app), undefined)
    await import(`${app}/${LAUNCHER_PAGE}`)
    expect(HOOKS.launcher.length).toBe(before + 1)
    expect(launcherOf(HOOKS.launcher.at(-1)?.item())).toMatchObject({
        width: 1200,
        height: 760,
    })
}, 30_000)

// 38.107 — A CALL THE LAUNCH NEVER READS IS REFUSED, naming the file. THE REVERT: drop the
// `refuseStrayLauncher` call in `compileApp`; the build exits 0, and the page's width is never read.
test('onLauncher called outside launcher.abide is a build error naming the file — 38.107', async () => {
    const app = appFixture({
        'index.abide': `<script server>
import { onLauncher } from '@abide/abide/server'

onLauncher(() => ({ width: 1200 }))
</script>

<main>home</main>`,
    })
    const built = await buildApp(app)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('index.abide calls onLauncher')
    expect(built.stderr).toContain('38.107')
}, 30_000)

const PAGE: Launch = {
    name: 'ledger',
    start: '/start',
    connect: '/connect',
    fields: [],
    url: '',
    failure: undefined,
    focus: undefined,
    icon: undefined,
    accent: undefined,
}

test('a start that asks for nothing posts from the page, with no dialog — 38.102', () => {
    const page = launcherPage(PAGE)
    expect(page).toContain('<form method="post" action="/start">')
    expect(page).not.toContain('id="start-dialog"')
    expect(page).toContain('data-opens="connect-dialog"')
})

test('a refused start opens its dialog on the refusal — 38.102', () => {
    const page = launcherPage({
        ...PAGE,
        failure: { form: 'start', message: 'no port', issues: {} },
    })
    expect(page).toContain('id="start-dialog"')
    expect(page).toContain("open('start-dialog')")
})

// THE REVERT: open only a refused form's dialog, as the first cut of this page did; the Connect…
// menu item lands on the page with nothing open.
test('the Connect… menu item opens the connect dialog — 38.102', () => {
    expect(launcherPage({ ...PAGE, focus: 'connect' })).toContain(
        "open('connect-dialog')",
    )
    // A start with nothing to ask has no dialog, so there is nothing to open.
    expect(launcherPage({ ...PAGE, focus: 'start' })).not.toContain(
        "open('start-dialog')",
    )
})

/** An app as `DesktopSession` boots one: a real server on `listen`, counted on `stop`. */
function fakeApp(stopped: string[], name: string): App {
    let server: Bun.Server<unknown> | undefined
    return {
        fetch: async () => new Response(name),
        run: async (fn) => await fn(),
        async listen(options) {
            server = Bun.serve({
                hostname: options?.hostname ?? '127.0.0.1',
                port: 0,
                fetch: () => new Response(name),
            })
            LISTENING.server = server
        },
        async stop() {
            stopped.push(name)
            await server?.stop(true)
        },
        [Symbol.asyncDispose]: async () => {},
    }
}

const BOTH = launcherOf({}) as Launcher

// 38.71-38.75 — THE WINDOW'S STATE, WITH NO WINDOW: a start serves the app booted here, a connect
// stops it and shows the address instead, and the next launch does again what this one did last.
// THE REVERT: drop `await this.disconnect()` from `DesktopSession.connect`; the started app is left
// serving behind the connected one, and `stopped` reads [] where ['first'] is due.
test('a session switches between the app it started and one it connected to — 38.71, 38.73, 38.74', async () => {
    const directory = `${tmpdir()}/abide-desktop-${crypto.randomUUID()}`
    const stopped: string[] = []
    const elsewhere = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () => new Response('remote'),
    })
    const remote = `${elsewhere.url.origin}/`
    let boots = 0
    const boot = async () =>
        fakeApp(stopped, boots++ === 0 ? 'first' : 'second')
    try {
        const session = await DesktopSession.open(directory, boot)
        expect(session.shown).toBeUndefined()

        expect(
            await session.start({ DESKTOP_TEST_NAME: 'ledger' }),
        ).toBeUndefined()
        const served = session.shown as string
        expect(await (await fetch(served)).text()).toBe('first')
        expect(session.remembered.last).toEqual({
            start: { DESKTOP_TEST_NAME: 'ledger' },
        })

        // A connect that fails leaves the app standing, and its refusal is shown once.
        expect((await session.connect('ftp://nowhere'))?.form).toBe('connect')
        expect(session.shown).toBe(served)
        expect(session.takeFailure()?.message).toBe(
            'ftp://nowhere is not an address.',
        )
        expect(session.takeFailure()).toBeUndefined()

        expect(await session.connect(elsewhere.url.origin)).toBeUndefined()
        expect(stopped).toEqual(['first'])
        expect(session.shown).toBe(remote)

        // 38.73 — the next launch reads what this one did last, and does it again.
        const relaunched = await DesktopSession.open(directory, boot)
        expect(relaunched.remembered.last).toEqual({ connect: remote })
        await relaunched.resume(BOTH)
        expect(relaunched.shown).toBe(remote)

        // 38.74 — a disconnect forgets it, so the launch after shows the launcher.
        await relaunched.forget()
        expect(relaunched.shown).toBeUndefined()
        const forgotten = await DesktopSession.open(directory, boot)
        await forgotten.resume(BOTH)
        expect(forgotten.shown).toBeUndefined()
    } finally {
        delete process.env.DESKTOP_TEST_NAME
        LISTENING.server = undefined
        await elsewhere.stop(true)
        await rm(directory, { recursive: true, force: true })
    }
})

// 38.72 — A START THE APP REFUSES IS THE START FORM'S: nothing is shown, and the refusal names it.
test('a start whose boot throws is refused on the start form — 38.72', async () => {
    const directory = `${tmpdir()}/abide-desktop-${crypto.randomUUID()}`
    try {
        const session = await DesktopSession.open(directory, async () => {
            throw new Error('PORT is not a number')
        })
        expect(await session.start({})).toEqual({
            form: 'start',
            message: 'PORT is not a number',
            issues: {},
        })
        expect(session.shown).toBeUndefined()
        expect(session.remembered.last).toBeNull()
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
