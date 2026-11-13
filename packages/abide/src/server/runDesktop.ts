// 38.70 — WHAT `abide bundle` WRITES, STARTED WITH NO COMMAND: a window on the app. Given a command
// it is the executable `abide compile` writes (`runCompiled`), so a terminal still reaches every one.
//
// ONE PROCESS. The app, the launcher's own page and the window share it, and the app is served on
// loopback for the window alone. What the window shows is the `DesktopSession`'s; the window itself
// is `openDesktopWindow`'s.

import { ICON_ADDRESSES, MENU_BAR_ICON_ADDRESS } from '#shared/NATIVE_FILES.ts'

import { dataDirectory, derived as appDerived } from './config.ts'
import { configFields } from './configFields.ts'
import { type AppOrigin, bootEntered, enterApp } from './createApp.ts'
import { DesktopSession } from './DesktopSession.ts'
import { appOf, DesktopUpdater } from './DesktopUpdater.ts'
import { executableName } from './executableName.ts'
import { HOOKS, inOrder, reportUnexpected } from './hooks.ts'
import { launcherOf } from './launcherOptions.ts'
import { type Launch, launcherPage } from './launcherPage.ts'
import { LOOPBACK } from './LOOPBACK.ts'
import type { MenuBarIcon } from './menuBarExtra.ts'
import { openDesktopWindow } from './openDesktopWindow.ts'
import { plainAnswer } from './plainAnswer.ts'
import { randomToken } from './randomToken.ts'
import { type Component, renderDocument } from './render.ts'
import { runCompiled } from './runCompiled.ts'
import { type BuildParts, builtSources } from './servedApp.ts'

/** What `abide bundle` read of the launcher's files, carried in the executable. */
export type Desktop = {
    /** 38.82 — `src/native/launcher.abide`'s page, where the app has one that paints. */
    launch:
        (() => Promise<{ default: (props: Launch) => Component }>) | undefined
    /** The document the launch page renders into, its stylesheet already in its head (38.84). */
    document: string
    /** 38.101 — the app's icon as a data URL, and the accent taken from it. */
    icon: string | undefined
    accent: string | undefined
    /** 38.143 — the public half of the key `abide bundle` signed this build's updates with. */
    publicKey: string
}

export async function runDesktop(
    origin: AppOrigin,
    parts: BuildParts,
    specifiers: Record<string, () => Promise<Record<string, unknown>>>,
    desktop: Desktop,
): Promise<void> {
    if (Bun.argv.length > 2 || process.platform !== 'darwin')
        return runCompiled(origin, parts, specifiers)
    await launch(
        origin,
        () => builtSources(parts),
        desktop,
        await menuBarIcon(parts.published),
    )
}

/**
 * 38.166 — what the menu bar extra is drawn from: the public `/icon-menubar.png` as a template the
 * platform tints, else `/icon.png` as it is, else nothing.
 */
async function menuBarIcon(
    published: Map<string, string>,
): Promise<MenuBarIcon | undefined> {
    for (const [address, template] of [
        [MENU_BAR_ICON_ADDRESS, true],
        [ICON_ADDRESSES.png, false],
    ] as const) {
        const path = published.get(address.slice(1))
        if (path !== undefined)
            return { bytes: await Bun.file(path).bytes(), template }
    }
    return undefined
}

async function launch(
    origin: AppOrigin,
    load: () => ReturnType<typeof builtSources>,
    { launch: launchModule, document, icon, accent, publicKey }: Desktop,
    extraIcon: MenuBarIcon | undefined,
): Promise<void> {
    // 37.1 — ENTERED ONCE, before the window: the start form reads `onConfig` and the launcher's
    // `onLauncher` is filed. Every start after it boots in what this entered (`bootEntered`).
    await enterApp(origin)
    // 38.85 — a launcher page that fails to load leaves the built-in page, with its defaults.
    const launchPage = await launchModule?.().catch((thrown: unknown) => {
        reportUnexpected(thrown)
        return undefined
    })
    // 38.80 — what its `onLauncher` answers.
    const options = launcherOf(inOrder(HOOKS.launcher).at(-1)?.())
    // 38.81 — an `onLauncher` answer the checker would have refused, written where nothing checked it.
    if (typeof options === 'string')
        throw new Error(`abide: ${options}. RULEBOOK 38.81.`)
    const appName = executableName(origin.package.name)
    const directory = dataDirectory(origin.package.name ?? 'app')
    const session = await DesktopSession.open(directory, () =>
        bootEntered(load),
    )
    const token = randomToken(16, 'hex')
    // 27.3 — the same derived layer `resolve` starts from, under what was given.
    const derived = (): Record<string, string | undefined> => ({
        ...appDerived(),
        ...process.env,
        ...session.remembered.values,
    })

    const launcher = Bun.serve({
        hostname: LOOPBACK,
        port: 0,
        async fetch(request) {
            const url = new URL(request.url)
            if (!url.pathname.startsWith(`/${token}/`))
                return plainAnswer('not found', 404)
            const action = url.pathname.slice(token.length + 2)
            if (
                options.start &&
                request.method === 'POST' &&
                action === 'start'
            ) {
                const form = await request.formData()
                const values: Record<string, string> = {}
                // THE LAST VALUE OF A NAME: a checkbox follows the hidden `false` it stands in for
                // when unchecked, so `get` — the first — would read every checked box as `false`.
                for (const field of configFields(derived()))
                    values[field.name] = String(
                        form.getAll(field.name).at(-1) ?? '',
                    )
                const started = await session.start(values)
                return started === undefined ? onwards() : page('start')
            }
            if (
                options.connect &&
                request.method === 'POST' &&
                action === 'connect'
            ) {
                const connected = await session.connect(
                    String((await request.formData()).get('url') ?? ''),
                )
                return connected === undefined ? onwards() : page('connect')
            }
            // The Connect… menu item asks for the page with its connect form open.
            return page(
                url.searchParams.get('focus') === 'connect'
                    ? 'connect'
                    : undefined,
            )
        },
    })
    const base = `${launcher.url.origin}/${token}/`
    // 38.71 — the answer to a start or a connect that took: the app the window now shows.
    const onwards = (): Response =>
        new Response(null, {
            status: 303,
            headers: { location: session.shown ?? base },
        })
    const page = async (
        focus: 'start' | 'connect' | undefined,
    ): Promise<Response> => {
        const shown = session.takeFailure()
        const props: Launch = {
            name: appName,
            start: options.start ? `${base}start` : undefined,
            connect: options.connect ? `${base}connect` : undefined,
            fields: configFields(derived()),
            url: session.remembered.url,
            failure: shown,
            focus:
                shown?.form ??
                (focus === 'connect' && options.connect ? focus : undefined),
            icon,
            accent,
        }
        const headers = { 'content-type': 'text/html; charset=utf-8' }
        if (launchPage !== undefined)
            try {
                return new Response(
                    await renderDocument(launchPage.default(props), document),
                    { headers },
                )
            } catch (thrown) {
                // 38.85 — the built-in page stands in for one that failed.
                reportUnexpected(thrown)
            }
        return new Response(launcherPage(props), { headers })
    }

    const version = origin.package.version ?? '0.0.0'
    // 38.142 — an app outside a `.app` has nothing to replace, and checks for nothing.
    const bundled = appOf(process.execPath)
    const updater =
        options.update === undefined || bundled === undefined
            ? undefined
            : new DesktopUpdater(
                  options.update,
                  publicKey,
                  bundled,
                  version,
                  () => {},
              )
    const navigate = openDesktopWindow(
        appName,
        version,
        options,
        base,
        session,
        updater,
        extraIcon,
    )
    await session.resume(options)
    navigate(session.shown ?? base)
    if (updater === undefined) return
    // 38.142 — as it launches and hourly after; a feed that cannot be reached is tried again at
    // the next, and only a refusal is reported (38.143).
    const checkQuietly = (): void =>
        void updater.check().then((checked) => {
            if (checked.outcome === 'refused')
                reportUnexpected(
                    new Error(`abide: ${checked.reason}. RULEBOOK 38.143.`),
                )
        })
    checkQuietly()
    setInterval(checkQuietly, UPDATE_INTERVAL)
}

const UPDATE_INTERVAL = 60 * 60 * 1000
