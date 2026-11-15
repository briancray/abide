// 38.70 — WHAT `abide native` WRITES, STARTED WITH NO COMMAND: a window on the app. Given a command
// it is the executable `abide compile` writes (`runCompiled`), so a terminal still reaches every one.
//
// ONE PROCESS, TWO THREADS, ONE ENTRY. The main thread holds the window (`openNativeWindow`) and
// sleeps in AppKit's wait (`appKitLoop`); the launcher's thread — a worker the main thread starts on
// the same entry — holds the app, the launcher's own page, the session and the updater, so the app
// goes on answering while AppKit holds the main thread through a resize or a menu (38.179). The app
// is served on loopback for the window alone. The two threads talk in `ToWindow` and `ToLauncher`,
// and each message to the window is followed by a wake, since the main thread hears nothing until one.

import { ICON_ADDRESSES, MENU_BAR_ICON_ADDRESS } from '#shared/NATIVE_FILES.ts'

import { openWakePort } from './appKitLoop.ts'
import { NATIVE_COOKIE, serveLocally } from './bridgeRelay.ts'
import {
    addDerived,
    derived as appDerived,
    launcherDataDirectory,
} from './config.ts'
import { configFields } from './configFields.ts'
import { type AppOrigin, bootEntered, enterApp } from './createApp.ts'
import { executableName } from './executableName.ts'
import { HOOKS, inOrder, reportUnexpected } from './hooks.ts'
import { keepLogFile } from './keepLogFile.ts'
import { type Launcher, launcherOf } from './launcherOptions.ts'
import { type Launch, launcherPage } from './launcherPage.ts'
import { loginShellPath } from './loginShellPath.ts'
import { LOOPBACK } from './LOOPBACK.ts'
import type { MenuBarIcon } from './menuBarExtra.ts'
import { NativeSession } from './NativeSession.ts'
import { appOf, NativeUpdater, type Staged } from './NativeUpdater.ts'
import { type LauncherThread, openNativeWindow } from './openNativeWindow.ts'
import { plainAnswer } from './plainAnswer.ts'
import { randomToken } from './randomToken.ts'
import { type Component, renderDocument } from './render.ts'
import { runCompiled } from './runCompiled.ts'
import { type BuildParts, builtSources } from './servedApp.ts'
import { wakeWindow } from './wakeWindow.ts'

/** What `abide native` read of the launcher's files, carried in the executable. */
export type NativeBuild = {
    /** 38.87 — the name the app shows in its menu bar, its window and its `Launch`. */
    name: string
    /** 38.82 — `src/native/launcher.abide`'s page, where the app has one that paints. */
    launch:
        (() => Promise<{ default: (props: Launch) => Component }>) | undefined
    /** The document the launch page renders into, its stylesheet already in its head (38.84). */
    document: string
    /** 38.101 — the app's icon as a data URL, and the accent taken from it. */
    icon: string | undefined
    accent: string | undefined
    /** 38.143 — the public half of the key `abide native` signed this build's updates with. */
    publicKey: string
}

export async function runNative(
    origin: AppOrigin,
    parts: BuildParts,
    specifiers: Record<string, () => Promise<Record<string, unknown>>>,
    native: NativeBuild,
): Promise<void> {
    if (Bun.argv.length > 2 || process.platform !== 'darwin')
        return runCompiled(origin, parts, specifiers)
    if (Bun.isMainThread)
        return openWindow(native.name, origin.package, parts.published)
    await launch(origin, () => builtSources(parts), native)
}

/** What the launcher's thread tells the window. */
type ToWindow =
    | {
          kind: 'open'
          options: Launcher
          base: string
          background: [number, number, number] | null
          updates: boolean
      }
    | { kind: 'navigate'; address: string }
    | { kind: 'shown'; address: string | undefined }
    | { kind: 'staged'; staged: Staged }
    | { kind: 'answer'; call: number; value: unknown }
    | { kind: 'ended'; code: number }

/** What the window tells the launcher's thread; the first is where to wake it. */
type ToLauncher =
    | { kind: 'wake'; port: number }
    | {
          kind: 'call'
          call: number
          name: 'check' | 'forget' | 'hasPage'
          address: string
      }
    | { kind: 'background'; color: [number, number, number] }
    | { kind: 'report'; error: unknown }
    | { kind: 'quit'; reopen: boolean }

/**
 * The main thread: starts the launcher's thread on this same entry, opens the window on what it
 * answers, and from then on is AppKit's.
 */
async function openWindow(
    appName: string,
    identity: AppOrigin['package'],
    published: Map<string, string>,
): Promise<void> {
    const version = identity.version ?? '0.0.0'
    const icon = await menuBarIcon(published)
    const thread = new Worker(Bun.main)
    const tell = (message: ToLauncher): void => thread.postMessage(message)
    tell({ kind: 'wake', port: openWakePort() })
    // Each call's answer, by the number it was posted with.
    const answers = new Map<number, (value: unknown) => void>()
    let calls = 0
    const call = <Answer>(
        name: 'check' | 'forget' | 'hasPage',
        address = '',
    ): Promise<Answer> =>
        new Promise((answered) => {
            calls += 1
            answers.set(calls, answered as (value: unknown) => void)
            tell({ kind: 'call', call: calls, name, address })
        })
    let navigate: ((address: string) => void) | undefined
    let shown: string | undefined
    let updates: LauncherThread['updates']
    const launcher: LauncherThread = {
        get shown() {
            return shown
        },
        get updates() {
            return updates
        },
        forget: () => call('forget'),
        hasPage: (address) => call('hasPage', address),
        rememberBackground: (color) => tell({ kind: 'background', color }),
        quit: (reopen) => tell({ kind: 'quit', reopen }),
        report: (error) =>
            tell({
                kind: 'report',
                error:
                    error instanceof Error ? error : new Error(String(error)),
            }),
    }
    await new Promise<void>((resolve, reject) => {
        // A launcher's thread that fails before the window opens ends the process with its error.
        thread.onerror = (event) =>
            reject(event.error ?? new Error(event.message))
        thread.onmessage = ({ data }: MessageEvent<ToWindow>) => {
            if (data.kind === 'open') {
                if (data.updates)
                    updates = {
                        staged: undefined,
                        check: () => call('check'),
                        onStaged: () => {},
                    }
                navigate = openNativeWindow(
                    appName,
                    version,
                    data.options,
                    data.base,
                    data.background,
                    launcher,
                    icon,
                )
                resolve()
            } else if (data.kind === 'navigate') navigate?.(data.address)
            else if (data.kind === 'shown') shown = data.address
            else if (data.kind === 'staged' && updates !== undefined) {
                updates.staged = data.staged
                updates.onStaged()
            } else if (data.kind === 'answer') {
                answers.get(data.call)?.(data.value)
                answers.delete(data.call)
            } else if (data.kind === 'ended') process.exit(data.code)
        }
    })
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

/**
 * The launcher's thread: the app, the launcher's page, the session and the updater, and what the
 * window asks of them.
 */
async function launch(
    origin: AppOrigin,
    load: () => ReturnType<typeof builtSources>,
    {
        name: appName,
        launch: launchModule,
        document,
        icon,
        accent,
        publicKey,
    }: NativeBuild,
): Promise<void> {
    // A native app outlives a fault in it: it is reported, and the window stays.
    process.on('unhandledRejection', reportUnexpected)
    process.on('uncaughtException', reportUnexpected)
    const parent = globalThis as unknown as {
        postMessage(message: ToWindow): void
        onmessage: ((event: MessageEvent<ToLauncher>) => void) | null
    }
    // What the window asks before this thread can answer, heard once it can.
    const heard: Exclude<ToLauncher, { kind: 'wake' }>[] = []
    let hear = (message: (typeof heard)[number]): void =>
        void heard.push(message)
    let wakePort = 0
    parent.onmessage = ({ data }) => {
        if (data.kind === 'wake') wakePort = data.port
        else hear(data)
    }
    const tell = (message: ToWindow): void => {
        parent.postMessage(message)
        if (wakePort !== 0) wakeWindow(wakePort)
    }
    // 38.180 — a worker's `process.exit` ends the worker alone: the process ends with it, however it
    // came — the app's own, or the quit below.
    process.on('exit', (code) => tell({ kind: 'ended', code }))
    // 44.80 — what a terminal would find, for the app and for the Claude Code its own bridge runs.
    const path = loginShellPath()
    // 37.1 — ENTERED ONCE, before the window: the start form reads `onConfig` and the launcher's
    // `onLauncher` is filed. Every start after it boots in what this entered (`bootEntered`).
    const failedToEnter = await enterApp(origin).then(
        () => undefined,
        (thrown: unknown) => ({ thrown }),
    )
    // 38.186 — once `onConfig` is filed, so the log's folder is `APP_DATA_DIR`'s as `native.json`'s
    // is, and before what failed to enter is thrown, so the file holds it.
    const dataDirectory = launcherDataDirectory()
    keepLogFile(
        dataDirectory,
        executableName(origin.package.name),
        origin.package.version ?? '0.0.0',
    )
    if (failedToEnter !== undefined) throw failedToEnter.thrown
    const found = await path
    if (found !== undefined) process.env.PATH = found
    // 38.85 — a launcher page that fails to load leaves the built-in page, with its defaults.
    const launchPage = await launchModule?.().catch((thrown: unknown) => {
        reportUnexpected(thrown)
        return undefined
    })
    // 38.80 — what its `onLauncher` answers.
    const options = launcherOf(inOrder(HOOKS.launcher).at(-1)?.())
    // 38.80 — an `onLauncher` answer the checker would have refused, written where nothing checked it,
    // refused naming the clause it breaks.
    if (typeof options === 'string') throw new Error(`abide: ${options}.`)
    const session = await NativeSession.open(dataDirectory, () =>
        bootEntered(load),
    )
    // What the window holds of `session.shown`, told again whenever it moves.
    let toldShown: string | undefined
    const tellShown = (): void => {
        if (session.shown === toldShown) return
        toldShown = session.shown
        tell({ kind: 'shown', address: toldShown })
    }
    // 38.175 — a sign-in seals where the app declares no secret, and still opens after a relaunch:
    // derived, so the app's `onConfig` default and the env both still win (27.2).
    addDerived({
        ABIDE_PRINCIPAL_SECRET: session.remembered.principalSecret,
    })
    const token = randomToken(16, 'hex')
    // 44.77, 44.79 — THE WINDOW'S CREDENTIAL, held in a cookie the launcher sets on every page it
    // answers: a cookie is the host's and not the port's, so the app on loopback reads it too, and
    // `SameSite=Strict` keeps a page of any other site from sending it there.
    const secret = randomToken(16, 'hex')
    void serveLocally(secret)
    const credential = `${NATIVE_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Strict`
    // 38.73 — the environment as launched: a start writes its values into `process.env`.
    const launched = { ...process.env }
    // 38.73 — what the start form offers with nothing remembered, by field: a start, the one at
    // launch included, keeps only what it sent that differs from it.
    const offered = (): Record<string, string> => {
        const values: Record<string, string> = {}
        for (const field of configFields({ ...appDerived(), ...launched }))
            values[field.name] = field.value
        return values
    }
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
            const answer = await answerLauncher(
                request,
                url,
                url.pathname.slice(token.length + 2),
            )
            tellShown()
            answer.headers.append('set-cookie', credential)
            return answer
        },
    })
    const answerLauncher = async (
        request: Request,
        url: URL,
        action: string,
    ): Promise<Response> => {
        if (options.start && request.method === 'POST' && action === 'start') {
            const form = await request.formData()
            const offering = offered()
            const values: Record<string, string> = {}
            for (const name of Object.keys(offering))
                // THE LAST VALUE OF A NAME: a checkbox follows the hidden `false` it stands in for
                // when unchecked, so `get` — the first — would read every checked box as `false`.
                values[name] = String(form.getAll(name).at(-1) ?? '')
            const started = await session.start(values, offering)
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
        // What the window opens on at launch, through here so it carries the credential.
        if (action === 'open') return onwards()
        // The Connect… menu item asks for the page with its connect form open.
        return page(
            url.searchParams.get('focus') === 'connect' ? 'connect' : undefined,
        )
    }
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
            : new NativeUpdater(
                  options.update,
                  publicKey,
                  bundled,
                  version,
                  (staged) => tell({ kind: 'staged', staged }),
              )
    const answer = async (
        message: Extract<ToLauncher, { kind: 'call' }>,
    ): Promise<unknown> => {
        if (message.name === 'forget') {
            await session.forget()
            return tellShown()
        }
        if (message.name === 'hasPage')
            return fetch(message.address, { method: 'HEAD' }).then(
                (answered) => answered.ok,
                () => false,
            )
        const checked = await updater?.check()
        if (checked?.outcome === 'refused')
            reportUnexpected(
                new Error(`abide: ${checked.reason}. RULEBOOK 38.143.`),
            )
        return checked
    }
    hear = (message) => {
        if (message.kind === 'call')
            answer(message)
                .catch((thrown: unknown) => reportUnexpected(thrown))
                .then((value) =>
                    tell({ kind: 'answer', call: message.call, value }),
                )
        else if (message.kind === 'background')
            session.rememberBackground(message.color).catch(reportUnexpected)
        else if (message.kind === 'report') reportUnexpected(message.error)
        else if (message.kind === 'quit')
            // 38.76 — the app is stopped first, and the process ends after.
            session
                .disconnect()
                .then(async () => {
                    if (updater === undefined || !(await updater.install()))
                        return
                    // 38.145.
                    if (message.reopen)
                        Bun.spawn(['open', '-n', updater.app], {
                            stdio: ['ignore', 'ignore', 'ignore'],
                        }).unref()
                })
                .catch(reportUnexpected)
                .finally(() => process.exit(0))
    }
    for (const message of heard.splice(0)) hear(message)
    tell({
        kind: 'open',
        options,
        base,
        background: session.remembered.background,
        updates: updater !== undefined,
    })
    await session.resume(options, offered())
    tellShown()
    tell({ kind: 'navigate', address: `${base}open` })
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
