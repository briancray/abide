// 38.71-38.75, 38.80-38.81, 38.101-38.102, 38.107, 38.150-38.165, 38.182-38.185, 38.187 — the native launcher's session, options, accent
// and own page, apart from the window: none of the four needs one to be checked.
//
// THE REVERT, for the accent: average every opaque pixel instead of binning by hue, and dogfood's
// icon reads as a gray-green near its ground rather than the teal of its mark.

import { afterAll, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises' // bun exposes no directory removal of its own
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import { buildDirectory, servedBuild } from '#server/appBuild.ts'
import { derived, launcherDataDirectory } from '#server/config.ts'
import type { App } from '#server/createApp.ts'
import { HOOKS } from '#server/hooks.ts'
import { iconAccent, inkOn } from '#server/iconAccent.ts'
import {
    type Launcher,
    launcherOf,
    type LauncherOptions,
} from '#server/launcherOptions.ts'
import { type Launch, launcherPage } from '#server/launcherPage.ts'
import { menuBar, menuBarExtraMenu, opensInWindow } from '#server/menuBar.ts'
import { NativeSession } from '#server/NativeSession.ts'
import { LISTENING } from '#server/requestScope.ts'
import { windowBridge } from '#server/windowBridge.ts'
import { LAUNCHER_PAGE } from '#shared/NATIVE_FILES.ts'

import { appFixture, buildApp, serveApp } from './builtApp.ts'
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

test('the window options take their own values and default to a standard window — 38.150-38.163, 38.165', () => {
    expect(launcherOf({})).toMatchObject({
        titlebar: 'standard',
        vibrancy: undefined,
        appearance: 'system',
        resizable: true,
        fullScreen: true,
        alwaysOnTop: false,
        shadow: true,
        rememberFrame: true,
        inspector: true,
        dock: true,
        menuBarExtra: false,
        panelWidth: 360,
        panelHeight: 480,
        maxWidth: Number.POSITIVE_INFINITY,
    })
    expect(
        launcherOf({
            titlebar: 'inset',
            vibrancy: 'sidebar',
            appearance: 'dark',
        }),
    ).toMatchObject({
        titlebar: 'inset',
        vibrancy: 'sidebar',
        appearance: 'dark',
    })
    expect(launcherOf({ titlebar: 'frameless' })).toContain(
        '`titlebar` is not a launcher option, or "frameless"',
    )
    expect(launcherOf({ vibrancy: 'toString' })).toContain('`vibrancy`')
    expect(launcherOf({ resizable: 'no' })).toContain('`resizable`')
    expect(launcherOf({ dock: false })).toMatchObject({ dock: false })
})

// 38.183-38.185 — A DOCK THAT FOLLOWS THE WINDOW needs the menu bar extra to bring the window back,
// and its application menu's Quit closes the window where the extra's menu still quits. THE REVERT,
// for 38.184: `role: 'quit'` whatever `dockFollowsWindow` says; Cmd-Q stops the app it was to keep.
test('a Dock that follows the window stays in the menu bar on Quit — 38.183, 38.184, 38.185', () => {
    const resident: LauncherOptions = { dock: 'window', menuBarExtra: true }
    expect(launcherOf(resident)).toMatchObject({
        dock: 'window',
        menuBarExtra: true,
    })
    // @ts-expect-error — 38.185: nothing would bring a closed window back.
    const stranded: LauncherOptions = { dock: 'window' }
    expect(launcherOf(stranded)).toContain("`dock: 'window'`")
    expect(launcherOf({ dock: 'tray', menuBarExtra: true })).toContain(
        '`dock` is not a launcher option, or "tray"',
    )

    const quitOf = (dockFollowsWindow: boolean) => {
        const [application] = menuBar(
            'Faster',
            true,
            [],
            undefined,
            dockFollowsWindow,
        )
        if (application === undefined || application === 'separator')
            return undefined
        return application.items?.at(-1)
    }
    expect(quitOf(false)).toEqual({
        label: 'Quit Faster',
        role: 'quit',
        key: 'cmd+q',
    })
    expect(quitOf(true)).toEqual({
        label: 'Quit Faster',
        role: 'closeWindow',
        key: 'cmd+q',
    })
    expect(menuBarExtraMenu('Faster', []).at(-1)).toEqual({
        label: 'Quit Faster',
        role: 'quit',
        key: 'cmd+q',
    })
})

// THE REVERT is the group pushed above Quit: the slice reads Hide…Show All where Settings… is due.
test('a menu named for the app grows the application menu below About, in order — 38.88', () => {
    const [application] = menuBar(
        'Faster',
        true,
        [
            { label: 'Faster', items: [{ label: 'Settings…', key: 'cmd+,' }] },
            { label: 'Faster', items: [] },
            { label: 'Faster', items: [{ label: 'Account…' }] },
        ],
        'Check for Updates…',
        false,
    )
    if (application === undefined || application === 'separator')
        throw new Error('no application menu')
    expect(application.items?.slice(0, 7)).toEqual([
        { label: 'About Faster', role: 'about' },
        { label: 'Check for Updates…', role: 'update' },
        'separator',
        { label: 'Settings…', key: 'cmd+,' },
        'separator',
        { label: 'Account…' },
        'separator',
    ])
})

// THE REVERT is `added` pushed as it is: the right-click menu holds a `Faster` submenu.
test('the menu bar extra lists a menu named for the app in place — 38.170', () => {
    expect(
        menuBarExtraMenu('Faster', [
            { label: 'Faster', items: [{ label: 'Settings…', key: 'cmd+,' }] },
            { label: 'Reports', items: [] },
        ]),
    ).toEqual([
        { label: 'Open Faster', role: 'window' },
        'separator',
        { label: 'Settings…', key: 'cmd+,' },
        { label: 'Reports', items: [] },
        'separator',
        { label: 'Quit Faster', role: 'quit', key: 'cmd+q' },
    ])
})

// THE REVERT is the folder named off the package alone: it answers the derived folder where
// `/tmp/faster-dev` is due, and two builds of one app share one `native.json`.
test('the launcher remembers under the APP_DATA_DIR the environment sets — 38.73', () => {
    const asFound = process.env.APP_DATA_DIR
    try {
        process.env.APP_DATA_DIR = '/tmp/faster-dev'
        expect(launcherDataDirectory()).toBe('/tmp/faster-dev')
        delete process.env.APP_DATA_DIR
        expect(launcherDataDirectory()).toBe(derived().APP_DATA_DIR as string)
    } finally {
        if (asFound === undefined) delete process.env.APP_DATA_DIR
        else process.env.APP_DATA_DIR = asFound
    }
})

test('a maximum below the minimum is refused — 38.151', () => {
    expect(launcherOf({ maxWidth: 400 })).toContain(
        'maximum size below its minimum size',
    )
    expect(launcherOf({ maxWidth: 400, minWidth: 300 })).toMatchObject({
        maxWidth: 400,
    })
})

// 38.155 — THE BRIDGE DECIDES FROM THE PAGE WHICH PRESSES ARE THE TITLEBAR'S. THE REVERT: drop the
// control check, and the press on the button inside the titlebar posts a drag — 2 where 1 is due.
test('a press on the titlebar drags and a double press zooms, and a control in it is left alone — 38.155', () => {
    const posted: string[] = []
    const scope = globalThis as { webkit?: unknown }
    scope.webkit = {
        messageHandlers: {
            abideWindow: {
                postMessage: (message: string) => posted.push(message),
            },
        },
    }
    const header = document.createElement('header')
    header.setAttribute('data-abide-titlebar', '')
    header.innerHTML = '<span>Deals</span><button>New</button>'
    document.body.append(header)
    const press = (target: Element, detail: number): void => {
        target.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, button: 0, detail }),
        )
    }
    windowBridge()
    try {
        press(header.querySelector('span') as Element, 1)
        press(header.querySelector('button') as Element, 1)
        press(header, 2)
        press(document.body, 1)
        expect(posted).toEqual(['drag', 'zoom'])
    } finally {
        header.remove()
        delete scope.webkit
    }
})

// 38.80 — THE `onLauncher` `native/launcher.abide`'s SERVER BLOCK CALLS IS WHAT THE LAUNCH READS: the file is
// imported out of the build as `runNative` imports it, and the last one filed is the answer read.
// THE REVERT: have `onLauncher` file nothing (`return () => {}` in `hooks.ts`); importing the file
// files 0 where 1 is due, and the launch would read the default width, 1100, where 1200 is due.
test('the launch reads what launcher.abide files with onLauncher — 38.80', async () => {
    const app = appFixture({
        'index.abide': '<main>home</main>',
        'native/launcher.abide': `<script server>
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

// 38.167 — THE MENU BAR EXTRA'S PAGE IS ANSWERED BY THE APP, OUTSIDE EVERY LAYOUT, at an address in
// abide's own namespace. THE REVERTS: drop the `MENU_BAR_ADDRESS` arm of `isFrameworkAddress`; the
// framework lane answers it, a 404. Or drop the `MENU_BAR_PAGE` guard in `routesOf`; the root
// layout's `chrome` wraps the panel.
test('native/menubar.abide is a page answered outside every layout — 38.167', async () => {
    const { base, stop } = await serveApp({
        'index.abide': '<main>home</main>',
        'layout.abide': '<nav>chrome</nav><slot/>',
        'native/menubar.abide': '<main>panel</main>',
    })
    try {
        const answered = await fetch(`${base}/__abide/menubar`)
        expect(answered.status).toBe(200)
        const html = await answered.text()
        expect(html).toContain('<main')
        expect(html).toContain('panel')
        expect(html).not.toContain('chrome')
        expect(await (await fetch(`${base}/`)).text()).toContain('chrome')
    } finally {
        stop()
    }
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

test('the launcher page is dragged by a strip as tall as the titlebar — 38.164', () => {
    expect(launcherPage(PAGE)).toContain(
        '<div class="titlebar" data-abide-titlebar></div>',
    )
})

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

// 38.170, 38.177 — THE MENU BAR EXTRA'S MENU OPENS THE WINDOW FIRST, whatever the page filed, since
// a primary click on an extra with a panel never reaches it. THE REVERT: drop the `window` item from
// `menuBarExtraMenu`; the menu leads with the page's own and nothing in it shows the window.
test('the menu bar extra’s menu opens the window, then the page’s menus, then Quit — 38.170, 38.177', () => {
    expect(menuBarExtraMenu('Faster', [])).toEqual([
        { label: 'Open Faster', role: 'window' },
        'separator',
        { label: 'Quit Faster', role: 'quit', key: 'cmd+q' },
    ])
    expect(menuBarExtraMenu('Faster', [{ label: 'Refresh', id: 0 }])).toEqual([
        { label: 'Open Faster', role: 'window' },
        'separator',
        { label: 'Refresh', id: 0 },
        'separator',
        { label: 'Quit Faster', role: 'quit', key: 'cmd+q' },
    ])
})

// 38.176 — A NEW WINDOW ONTO THE APP IS THE WINDOW; anything else, or anything while the launcher
// shows, is the system's to open. THE REVERT: answer `shown !== undefined`; another site's page
// opens in the window.
test('a new window onto the app the window shows opens in the window — 38.176', () => {
    const shown = 'http://127.0.0.1:4100/crm/'
    expect(opensInWindow('http://127.0.0.1:4100/crm/deals/7', shown)).toBe(true)
    expect(opensInWindow('http://127.0.0.1:4100/other/', shown)).toBe(false)
    expect(opensInWindow('https://example.com/', shown)).toBe(false)
    expect(opensInWindow('http://127.0.0.1:4100/crm/deals/7', undefined)).toBe(
        false,
    )
})

/** An app as `NativeSession` boots one: a real server on `listen`, counted on `stop`. */
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
// THE REVERT: drop `await this.disconnect()` from `NativeSession.connect`; the started app is left
// serving behind the connected one, and `stopped` reads [] where ['first'] is due.
test('a session switches between the app it started and one it connected to — 38.71, 38.73, 38.74', async () => {
    const directory = `${tmpdir()}/abide-native-${crypto.randomUUID()}`
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
        const session = await NativeSession.open(directory, boot)
        expect(session.shown).toBeUndefined()

        expect(
            await session.start({ NATIVE_TEST_NAME: 'ledger' }),
        ).toBeUndefined()
        const served = session.shown as string
        expect(await (await fetch(served)).text()).toBe('first')
        expect(session.remembered.last).toEqual({
            start: { NATIVE_TEST_NAME: 'ledger' },
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
        const relaunched = await NativeSession.open(directory, boot)
        expect(relaunched.remembered.last).toEqual({ connect: remote })
        await relaunched.resume(BOTH, {})
        expect(relaunched.shown).toBe(remote)

        // 38.74 — a disconnect forgets it, so the launch after shows the launcher.
        await relaunched.forget()
        expect(relaunched.shown).toBeUndefined()
        const forgotten = await NativeSession.open(directory, boot)
        await forgotten.resume(BOTH, {})
        expect(forgotten.shown).toBeUndefined()
    } finally {
        delete process.env.NATIVE_TEST_NAME
        LISTENING.server = undefined
        await elsewhere.stop(true)
        await rm(directory, { recursive: true, force: true })
    }
})

// 38.73 — A VALUE NOBODY CHANGED IS NOT REMEMBERED, so the next launch takes what the app offers
// then: a default a release moved reaches a copy started before it. THE REVERT: remember `values`
// rather than `kept` in `NativeSession.start`; the relaunch boots with NATIVE_TEST_REGION pinned to
// `eu`, the default the release moved away from.
test('a start remembers only the values changed from what its form offered — 38.73', async () => {
    const directory = `${tmpdir()}/abide-native-${crypto.randomUUID()}`
    const stopped: string[] = []
    const seen: (string | undefined)[] = []
    const boot = async () => {
        seen.push(process.env.NATIVE_TEST_REGION)
        return fakeApp(stopped, 'app')
    }
    try {
        const session = await NativeSession.open(directory, boot)
        await session.start(
            { NATIVE_TEST_NAME: 'ledger', NATIVE_TEST_REGION: 'eu' },
            { NATIVE_TEST_NAME: '', NATIVE_TEST_REGION: 'eu' },
        )
        expect(seen).toEqual(['eu'])
        expect(session.remembered.last).toEqual({
            start: { NATIVE_TEST_NAME: 'ledger' },
        })
        expect(session.remembered.values).toEqual({
            NATIVE_TEST_NAME: 'ledger',
        })
        await session.disconnect()

        // The next launch is a fresh process: nothing the last one started under is in its env.
        delete process.env.NATIVE_TEST_NAME
        delete process.env.NATIVE_TEST_REGION
        const relaunched = await NativeSession.open(directory, boot)
        await relaunched.resume(BOTH, {
            NATIVE_TEST_NAME: '',
            NATIVE_TEST_REGION: 'us',
        })
        expect(seen).toEqual(['eu', undefined])
        expect(relaunched.remembered.last).toEqual({
            start: { NATIVE_TEST_NAME: 'ledger' },
        })
        await relaunched.disconnect()
    } finally {
        delete process.env.NATIVE_TEST_NAME
        delete process.env.NATIVE_TEST_REGION
        LISTENING.server = undefined
        await rm(directory, { recursive: true, force: true })
    }
})

// 38.73 — THE START AT LAUNCH FORGETS AS ANY START DOES: a remembered value the app has since come to
// offer is no longer the person's, so the release after that moves it reaches the copy. THE REVERT:
// `this.start(last.start)` in `resume`, with no `offered`; `us` stays remembered, and the third
// launch boots with NATIVE_TEST_REGION pinned to it rather than at the `ap` its release offers.
test('a start at launch forgets a remembered value the app now offers — 38.73', async () => {
    const directory = `${tmpdir()}/abide-native-${crypto.randomUUID()}`
    const seen: (string | undefined)[] = []
    const boot = async () => {
        seen.push(process.env.NATIVE_TEST_REGION)
        return fakeApp([], 'app')
    }
    const relaunch = async (offered: Record<string, string>) => {
        delete process.env.NATIVE_TEST_REGION
        const session = await NativeSession.open(directory, boot)
        await session.resume(BOTH, offered)
        await session.disconnect()
        return session
    }
    try {
        const session = await NativeSession.open(directory, boot)
        await session.start(
            { NATIVE_TEST_REGION: 'us' },
            { NATIVE_TEST_REGION: 'eu' },
        )
        await session.disconnect()
        // A release makes `us` the default, and the next one moves it on to `ap`.
        const adopted = await relaunch({ NATIVE_TEST_REGION: 'us' })
        expect(adopted.remembered.last).toEqual({ start: {} })
        await relaunch({ NATIVE_TEST_REGION: 'ap' })
        expect(seen).toEqual(['us', 'us', undefined])
    } finally {
        delete process.env.NATIVE_TEST_REGION
        LISTENING.server = undefined
        await rm(directory, { recursive: true, force: true })
    }
})

// 38.182 — A LAUNCHER WITH ONE FORM AND NOTHING TO ASK starts at once, so the window opens on the app
// rather than on a lone button. A form with a field, or a second form, still waits for the person.
// THE REVERT: drop the last arm of `NativeSession.resume`; the first launch shows nothing.
test('a launcher whose one form asks for nothing starts at launch — 38.182', async () => {
    const directory = `${tmpdir()}/abide-native-${crypto.randomUUID()}`
    const startOnly = launcherOf({ connect: false }) as Launcher
    try {
        const asks = await NativeSession.open(directory, async () =>
            fakeApp([], 'app'),
        )
        await asks.resume(startOnly, { NATIVE_TEST_REGION: 'eu' })
        expect(asks.shown).toBeUndefined()
        await asks.resume(BOTH, {})
        expect(asks.shown).toBeUndefined()

        const session = await NativeSession.open(directory, async () =>
            fakeApp([], 'app'),
        )
        await session.resume(startOnly, {})
        expect(session.shown).toBeDefined()
        expect(session.remembered.last).toEqual({ start: {} })
        await session.disconnect()
    } finally {
        LISTENING.server = undefined
        await rm(directory, { recursive: true, force: true })
    }
})

// 38.187 — TOLD TO START AT ONCE, the launcher does so with a form that asks and connecting still
// offered: the defaults are what it starts with, and nothing of them is remembered as the person's.
// THE REVERT: drop the `'immediately'` arm of `NativeSession.resume`; the first launch shows nothing.
test('a launcher told to start immediately starts at launch whatever it asks — 38.187', async () => {
    const directory = `${tmpdir()}/abide-native-${crypto.randomUUID()}`
    const immediately = launcherOf({ start: 'immediately' }) as Launcher
    try {
        const session = await NativeSession.open(directory, async () =>
            fakeApp([], 'app'),
        )
        await session.resume(immediately, { NATIVE_TEST_REGION: 'eu' })
        expect(session.shown).toBeDefined()
        expect(session.remembered.values).toEqual({})
        await session.disconnect()
    } finally {
        LISTENING.server = undefined
        await rm(directory, { recursive: true, force: true })
    }
})

// 38.175 — THE LAUNCHER'S OWN PRINCIPAL SECRET is minted once and kept beside what it remembers, so a
// sign-in sealed under it still opens after a relaunch, and a disconnect does not forget it. THE
// REVERT: mint it in `open` without reading `native.json` over it; the relaunch reads another.
test('the launcher mints a principal secret once and keeps it across launches — 38.175', async () => {
    const directory = `${tmpdir()}/abide-native-${crypto.randomUUID()}`
    try {
        const session = await NativeSession.open(directory, async () =>
            fakeApp([], 'app'),
        )
        const secret = session.remembered.principalSecret
        expect(secret).toMatch(/^[0-9a-f]{64}$/)
        await session.start({})
        await session.forget()
        const relaunched = await NativeSession.open(directory, async () =>
            fakeApp([], 'app'),
        )
        expect(relaunched.remembered.principalSecret).toBe(secret)
        const elsewhere = await NativeSession.open(
            `${directory}-other`,
            async () => fakeApp([], 'app'),
        )
        expect(elsewhere.remembered.principalSecret).not.toBe(secret)
    } finally {
        LISTENING.server = undefined
        await rm(directory, { recursive: true, force: true })
    }
})

// 38.72 — A START THE APP REFUSES IS THE START FORM'S: nothing is shown, and the refusal names it.
test('a start whose boot throws is refused on the start form — 38.72', async () => {
    const directory = `${tmpdir()}/abide-native-${crypto.randomUUID()}`
    try {
        const session = await NativeSession.open(directory, async () => {
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
