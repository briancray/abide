// 38.70 — WHAT `abide bundle` WRITES, STARTED WITH NO COMMAND: a window on the app. Given a command
// it is the executable `abide compile` writes (`runCompiled`), so a terminal still reaches every one.
//
// ONE PROCESS. The app, the launcher's own page and the window share it: AppKit's events are drained
// on a timer rather than by `[NSApp run]`, which would never hand the thread back to bun, and the app
// is served on loopback for the window alone. A menu held open or a window being resized runs
// AppKit's own loop inside one drain, and the app answers nothing until it ends.

import { FFIType } from 'bun:ffi'
import { mkdir } from 'node:fs/promises' // bun exposes no directory creation of its own
import { isFailed } from '#shared/Failed.ts'
import {
    callBlock,
    created,
    definedClass,
    type Id,
    nsBoolean,
    nsString,
    objcClass,
    selector,
    send,
    sendTyped,
    stringOf,
} from './appKit.ts'
import { configuredMount, dataDirectory } from './config.ts'
import { configFields } from './configFields.ts'
import { type App, type AppOrigin, bootEntered, enterApp } from './createApp.ts'
import { executableName } from './executableName.ts'
import { HOOKS, inOrder, reportUnexpected } from './hooks.ts'
import { launcherOf } from './launcherOptions.ts'
import { type Launch, launcherPage } from './launcherPage.ts'
import { installMenu, menuBar, type NativeItem } from './nativeMenu.ts'
import { randomToken } from './randomToken.ts'
import { type Component, renderDocument } from './render.ts'
import { LISTENING } from './requestScope.ts'
import { runCompiled } from './runCompiled.ts'
import { type BuildParts, builtSources } from './serveBuild.ts'

/** What the launcher did last, and what its forms held, kept across launches. 38.73. */
type Remembered = {
    last: { start: Record<string, string> } | { connect: string } | null
    values: Record<string, string>
    url: string
    port: number
}

type Failure = {
    form: 'start' | 'connect'
    message: string
    issues: Record<string, string[]>
}

/** What `abide bundle` read of the launcher's files, carried in the executable. */
export type Desktop = {
    /** 38.82 — `src/launcher.abide`'s page, where the app has one that paints. */
    launch:
        | (() => Promise<{ default: (props: Launch) => Component }>)
        | undefined
    /** The document the launch page renders into, its stylesheet already in its head (38.84). */
    document: string
    /** 38.101 — the app's icon as a data URL, and the accent taken from it. */
    icon: string | undefined
    accent: string | undefined
}

const LOOPBACK = '127.0.0.1'
const DRAIN_MILLISECONDS = 8
const CONNECT_TIMEOUT_MILLISECONDS = 5000

export async function runDesktop(
    origin: AppOrigin,
    parts: BuildParts,
    specifiers: Record<string, () => Promise<Record<string, unknown>>>,
    desktop: Desktop,
): Promise<void> {
    if (Bun.argv.length > 2 || process.platform !== 'darwin')
        return runCompiled(origin, parts, specifiers)
    await launch(origin, () => builtSources(parts), desktop)
}

async function launch(
    origin: AppOrigin,
    load: () => ReturnType<typeof builtSources>,
    { launch: launchModule, document, icon, accent }: Desktop,
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
    const stateFile = `${directory}/desktop.json`
    const remembered: Remembered = {
        last: null,
        values: {},
        url: '',
        port: 0,
        ...(await Bun.file(stateFile)
            .json()
            .catch(() => ({}))),
    }
    const remember = async (): Promise<void> => {
        await mkdir(directory, { recursive: true })
        await Bun.write(stateFile, JSON.stringify(remembered, null, 4))
    }

    // What the window shows: the app served here, one elsewhere, or neither.
    let current: { url: string; app: App | undefined } | undefined
    let failure: Failure | undefined
    const token = randomToken(16, 'hex')
    const derived = (): Record<string, string | undefined> => ({
        APP_NAME: origin.package.name ?? 'app',
        APP_VERSION: origin.package.version ?? '0.0.0',
        APP_DATA_DIR: directory,
        ...process.env,
        ...remembered.values,
    })

    const launcher = Bun.serve({
        hostname: LOOPBACK,
        port: 0,
        async fetch(request) {
            const url = new URL(request.url)
            if (!url.pathname.startsWith(`/${token}/`))
                return new Response('not found', { status: 404 })
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
                const started = await start(values)
                return started === undefined ? onwards() : page('start')
            }
            if (
                options.connect &&
                request.method === 'POST' &&
                action === 'connect'
            ) {
                const connected = await connect(
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
            headers: { location: current?.url ?? base },
        })
    const page = async (
        focus: 'start' | 'connect' | undefined,
    ): Promise<Response> => {
        const shown = failure
        failure = undefined
        const props: Launch = {
            name: appName,
            start: options.start ? `${base}start` : undefined,
            connect: options.connect ? `${base}connect` : undefined,
            fields: configFields(derived()),
            url: remembered.url,
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

    async function disconnect(): Promise<void> {
        const leaving = current
        current = undefined
        if (leaving?.app !== undefined)
            await leaving.app.stop().catch(reportUnexpected)
    }

    // 38.72 — the form's values are the environment the app is booted under, so 27.8 coerces them
    // and 27.7's schema refuses them as it would any other.
    async function start(
        values: Record<string, string>,
    ): Promise<Failure | undefined> {
        await disconnect()
        remembered.values = values
        for (const [name, value] of Object.entries(values))
            if (value === '') delete process.env[name]
            else process.env[name] = value
        let app: App
        try {
            app = await bootEntered(load)
        } catch (thrown) {
            failure = refused('start', thrown)
            return failure
        }
        try {
            await app
                // 38.75.
                .listen({ hostname: LOOPBACK, port: remembered.port })
                // The port the last launch served on, so the app's origin — and its storage with
                // it — is the one it had; any free one where that is taken.
                .catch(() => app.listen({ hostname: LOOPBACK, port: 0 }))
        } catch (thrown) {
            await app.stop().catch(reportUnexpected)
            failure = refused('start', thrown)
            return failure
        }
        const server = LISTENING.server as Bun.Server<unknown>
        remembered.port = server.port ?? 0
        remembered.last = { start: values }
        current = { url: `${server.url.origin}${configuredMount()}/`, app }
        await remember()
        return undefined
    }

    async function connect(given: string): Promise<Failure | undefined> {
        const text = given.trim()
        remembered.url = text
        const url = URL.parse(
            /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`,
        )
        if (
            url === null ||
            (url.protocol !== 'http:' && url.protocol !== 'https:')
        ) {
            failure = {
                form: 'connect',
                message: `${text} is not an address.`,
                issues: {},
            }
            return failure
        }
        try {
            await fetch(url, {
                method: 'HEAD',
                redirect: 'manual',
                signal: AbortSignal.timeout(CONNECT_TIMEOUT_MILLISECONDS),
            })
        } catch {
            failure = {
                form: 'connect',
                message: `Nothing answered at ${url.origin}.`,
                issues: {},
            }
            return failure
        }
        await disconnect()
        remembered.last = { connect: url.href }
        current = { url: url.href, app: undefined }
        await remember()
        return undefined
    }

    // THE WINDOW.
    const application = send(objcClass('NSApplication'), 'sharedApplication')
    // Regular: a Dock icon and a menu bar, which a process outside a `.app` does not get by default.
    sendTyped(
        application,
        'setActivationPolicy:',
        [FFIType.i64],
        FFIType.void,
        0,
    )
    let quitting = false
    const quit = (): void => {
        if (quitting) return
        quitting = true
        disconnect().finally(() => process.exit(0))
    }
    send(
        application,
        'setDelegate:',
        send(
            definedClass('AbideApplicationDelegate', {
                'applicationShouldTerminate:': {
                    types: 'Q@:@',
                    args: [FFIType.ptr],
                    returns: FFIType.u64,
                    // NSTerminateCancel: 38.76 — the app is stopped first, and the process ends after.
                    run: () => {
                        quit()
                        return 0
                    },
                },
                'applicationShouldTerminateAfterLastWindowClosed:': {
                    types: 'c@:@',
                    args: [FFIType.ptr],
                    returns: FFIType.bool,
                    run: () => true,
                },
            }),
            'new',
        ),
    )
    for (const signal of ['SIGTERM', 'SIGINT'] as const)
        process.on(signal, quit)
    // A desktop app outlives a fault in it: it is reported, and the window stays.
    process.on('unhandledRejection', reportUnexpected)
    process.on('uncaughtException', reportUnexpected)

    const window = created('NSWindow')
    // Titled, closable, miniaturizable, resizable.
    sendTyped(window, 'setStyleMask:', [FFIType.u64], FFIType.void, 15)
    sendTyped(
        window,
        'setReleasedWhenClosed:',
        [FFIType.bool],
        FFIType.void,
        false,
    )
    sendTyped(
        window,
        'setContentSize:',
        [FFIType.f64, FFIType.f64],
        FFIType.void,
        options.width,
        options.height,
    )
    sendTyped(
        window,
        'setContentMinSize:',
        [FFIType.f64, FFIType.f64],
        FFIType.void,
        options.minWidth,
        options.minHeight,
    )
    send(window, 'center')
    // Where the window was and how large, as the last launch left it.
    sendTyped(
        window,
        'setFrameAutosaveName:',
        [FFIType.ptr],
        FFIType.bool,
        nsString(`${appName} window`),
    )
    send(window, 'setTitle:', nsString(appName))

    const view = created('WKWebView')
    send(
        send(send(view, 'configuration'), 'preferences'),
        'setValue:forKey:',
        nsBoolean(true),
        nsString('developerExtrasEnabled'),
    )
    if (
        sendTyped(
            view,
            'respondsToSelector:',
            [FFIType.ptr],
            FFIType.bool,
            selector('setInspectable:'),
        )
    )
        sendTyped(view, 'setInspectable:', [FFIType.bool], FFIType.void, true)
    send(view, 'setUIDelegate:', send(uiDelegateClass(), 'new'))
    send(window, 'setContentView:', view)
    send(
        view,
        'loadHTMLString:baseURL:',
        nsString(
            '<!doctype html><style>:root{color-scheme:light dark;background:#f5f5f7}@media (prefers-color-scheme:dark){:root{background:#1c1c1e}}</style>',
        ),
        null,
    )
    // 38.88 — THE MENU BAR IS THE PAGE'S: the defaults until the page the window loads tells it
    // what its route exports, and again after every navigation it makes.
    const showMenu = (told: NativeItem[]): void =>
        installMenu(menuBar(appName, options.connect, told), (item) => {
            if (item.role === 'connect')
                return navigate(`${base}?focus=connect`)
            // 38.74.
            if (item.role === 'disconnect') {
                remembered.last = null
                void remember()
                return void disconnect().then(() => navigate(base))
            }
            if (item.role === 'reload') return void send(view, 'reload')
            // 38.90, 38.91 — the page that numbered the item does what it means.
            if (item.id !== undefined)
                send(
                    view,
                    'evaluateJavaScript:completionHandler:',
                    nsString(
                        `dispatchEvent(new CustomEvent('abide:menu', { detail: ${item.id} }))`,
                    ),
                    null,
                )
        })
    send(
        send(send(view, 'configuration'), 'userContentController'),
        'addScriptMessageHandler:name:',
        send(
            definedClass('AbideMenuBridge', {
                'userContentController:didReceiveScriptMessage:': {
                    types: 'v@:@@',
                    args: [FFIType.ptr, FFIType.ptr],
                    returns: FFIType.void,
                    run: (_controller: Id, message: Id) => {
                        try {
                            showMenu(
                                JSON.parse(
                                    stringOf(send(message, 'body')),
                                ) as NativeItem[],
                            )
                        } catch (thrown) {
                            reportUnexpected(thrown)
                        }
                    },
                },
            }),
            'new',
        ),
        nsString('abideMenu'),
    )
    const navigate = (address: string): void => {
        // 38.92.
        showMenu([])
        send(
            view,
            'loadRequest:',
            send(
                objcClass('NSURLRequest'),
                'requestWithURL:',
                send(objcClass('NSURL'), 'URLWithString:', nsString(address)),
            ),
        )
    }
    showMenu([])

    send(window, 'makeKeyAndOrderFront:', null)
    sendTyped(
        application,
        'activateIgnoringOtherApps:',
        [FFIType.bool],
        FFIType.void,
        true,
    )
    send(application, 'finishLaunching')

    const distantPast = send(objcClass('NSDate'), 'distantPast')
    const defaultMode = nsString('kCFRunLoopDefaultMode')
    let shownTitle = appName
    let drains = 0
    setInterval(() => {
        for (;;) {
            const event = sendTyped(
                application,
                'nextEventMatchingMask:untilDate:inMode:dequeue:',
                [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.bool],
                FFIType.ptr,
                0xffffffffffffffffn,
                distantPast,
                defaultMode,
                true,
            ) as Id
            if (event === null) break
            send(application, 'sendEvent:', event)
        }
        // The window is titled by the page it shows.
        drains += 1
        if (drains % 32 !== 0) return
        const title = stringOf(send(view, 'title')) || appName
        if (title === shownTitle) return
        shownTitle = title
        send(window, 'setTitle:', nsString(title))
    }, DRAIN_MILLISECONDS)

    // 38.73 — WHAT IT DID LAST, done again.
    const last = remembered.last
    if (options.start && last !== null && 'start' in last)
        await start(last.start)
    else if (options.connect && last !== null && 'connect' in last)
        await connect(last.connect)
    navigate(current?.url ?? base)
}

/** A refusal as the form it came back to: 27.7's issues by field, or the error's message. */
function refused(form: 'start' | 'connect', thrown: unknown): Failure {
    if (
        isFailed(thrown) &&
        thrown.data !== null &&
        typeof thrown.data === 'object'
    )
        return {
            form,
            message: 'The configuration was refused.',
            issues: Array.isArray(thrown.data)
                ? { '': thrown.data as string[] }
                : (thrown.data as Record<string, string[]>),
        }
    return {
        form,
        message: thrown instanceof Error ? thrown.message : String(thrown),
        issues: {},
    }
}

// What a page asks of its window: a link out opens in the browser, and `alert` and `confirm` are
// sheets the page waits on.
let uiDelegate: Id = null
function uiDelegateClass(): Id {
    uiDelegate ??= definedClass('AbideUIDelegate', {
        'webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:':
            {
                types: '@@:@@@@',
                args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
                returns: FFIType.ptr,
                run: (_view: Id, _configuration: Id, action: Id) => {
                    const url = send(send(action, 'request'), 'URL')
                    if (url !== null)
                        send(
                            send(objcClass('NSWorkspace'), 'sharedWorkspace'),
                            'openURL:',
                            url,
                        )
                    return null
                },
            },
        'webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:':
            {
                types: 'v@:@@@@?',
                args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
                returns: FFIType.void,
                run: (_view: Id, message: Id, _frame: Id, done: Id) => {
                    alert(message, false)
                    callBlock(done, [])
                },
            },
        'webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:':
            {
                types: 'v@:@@@@?',
                args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
                returns: FFIType.void,
                run: (_view: Id, message: Id, _frame: Id, done: Id) => {
                    callBlock(done, [FFIType.bool], alert(message, true))
                },
            },
    })
    return uiDelegate
}

// An `NSAlert` with the page's message; answers whether it was accepted.
function alert(message: Id, cancellable: boolean): boolean {
    const panel = created('NSAlert')
    send(panel, 'setMessageText:', message)
    send(panel, 'addButtonWithTitle:', nsString('OK'))
    if (cancellable) send(panel, 'addButtonWithTitle:', nsString('Cancel'))
    // NSAlertFirstButtonReturn.
    return (
        Number(sendTyped(panel, 'runModal', [], FFIType.i64) as bigint) === 1000
    )
}
