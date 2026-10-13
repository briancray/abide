// 38.80-38.81, 38.101-38.102, 38.107 — the desktop launcher's options, its accent and its own page,
// apart from the window: none of the three needs one to be checked.
//
// THE REVERT, for the accent: average every opaque pixel instead of binning by hue, and dogfood's
// icon reads as a gray-green near its ground rather than the teal of its mark.

import { afterAll, expect, test } from 'bun:test'
import { HOOKS } from '#server/hooks.ts'
import { iconAccent, inkOn } from '#server/iconAccent.ts'
import { launcherOf } from '#server/launcherOptions.ts'
import { type Launch, launcherPage } from '#server/launcherPage.ts'
import { serveBuild } from '#server/serveBuild.ts'
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
    await serveBuild(app, `${app}/.abide`)
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
