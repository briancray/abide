// 38.70 — THE WINDOW `abide bundle`'S EXECUTABLE OPENS, over AppKit through `bun:ffi`: a WKWebView, the
// page's menu bar and an event drain. What it shows is the `NativeSession`'s to decide.
//
// AppKit's events are drained on a timer rather than by `[NSApp run]`, which would never hand the
// thread back to bun. A menu held open or a window being resized runs AppKit's own loop inside one
// drain, and the app answers nothing until it ends.

import { FFIType } from 'bun:ffi'

import type { NativeMenuItem } from '#shared/menuItem.ts'

import {
    callBlock,
    created,
    definedClass,
    type Id,
    nsBoolean,
    nsString,
    objcClass,
    rectOf,
    selector,
    send,
    sendTyped,
    stringOf,
} from './appKit.ts'
import { reportUnexpected } from './hooks.ts'
import { installMenu } from './installMenu.ts'
import { type Launcher, VIBRANCY_MATERIALS } from './launcherOptions.ts'
import { menuBar } from './menuBar.ts'
import { type MenuBarIcon, openMenuBarExtra } from './menuBarExtra.ts'
import type { NativeSession } from './NativeSession.ts'
import type { NativeUpdater } from './NativeUpdater.ts'
import { nativeUserAgent } from './nativeUserAgent.ts'
import { windowBridge } from './windowBridge.ts'

const DRAIN_MILLISECONDS = 8

// NSWindowStyleMask.
const TITLED = 1
const CLOSABLE = 2
const MINIATURIZABLE = 4
const RESIZABLE = 8
const FULL_SIZE_CONTENT_VIEW = 1 << 15
// NSWindowCollectionBehavior.
const FULL_SCREEN_PRIMARY = 1 << 7
const FULL_SCREEN_NONE = 1 << 9
const FLOATING_WINDOW_LEVEL = 3
const UNIFIED_TOOLBAR_STYLE = 3
const CLOSE_BUTTON = 0
const ZOOM_BUTTON = 2

/**
 * Opens the app's window on a blank page and answers how to point it at an address.
 *
 * `base` is the launcher's own page, which the Connect… and Disconnect menu items lead back to,
 * and `version` the `.app`'s, which every request the window makes names (38.140). Quitting stops
 * the session's app before the process ends (38.76), and then installs what `updater` staged
 * (38.144).
 */
export function openNativeWindow(
    appName: string,
    version: string,
    options: Launcher,
    base: string,
    session: NativeSession,
    updater: NativeUpdater | undefined,
    menuBarIcon: MenuBarIcon | undefined,
): (address: string) => void {
    const application = send(objcClass('NSApplication'), 'sharedApplication')
    // Regular: a Dock icon and a menu bar, which a process outside a `.app` does not get by default.
    // 38.165 — accessory: neither.
    sendTyped(
        application,
        'setActivationPolicy:',
        [FFIType.i64],
        FFIType.void,
        options.dock ? 0 : 1,
    )
    let quitting = false
    // 38.145 — set by a restart the person asked for, so the update installed is opened.
    let reopen = false
    const quit = (): void => {
        if (quitting) return
        quitting = true
        session
            .disconnect()
            .then(async () => {
                if (updater === undefined || !(await updater.install())) return
                if (reopen)
                    Bun.spawn(['open', '-n', updater.app], {
                        stdio: ['ignore', 'ignore', 'ignore'],
                    }).unref()
            })
            .catch(reportUnexpected)
            .finally(() => process.exit(0))
    }
    const restart = (): void => {
        reopen = true
        quit()
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
                // 38.172 — the menu bar extra outlives the window it shows and hides.
                'applicationShouldTerminateAfterLastWindowClosed:': {
                    types: 'c@:@',
                    args: [FFIType.ptr],
                    returns: FFIType.bool,
                    run: () => !options.menuBarExtra,
                },
                // 38.173.
                'applicationShouldHandleReopen:hasVisibleWindows:': {
                    types: 'c@:@c',
                    args: [FFIType.ptr, FFIType.bool],
                    returns: FFIType.bool,
                    run: (_application: Id, visible: boolean) => {
                        if (!visible)
                            send(window, 'makeKeyAndOrderFront:', null)
                        return true
                    },
                },
            }),
            'new',
        ),
    )
    for (const signal of ['SIGTERM', 'SIGINT'] as const)
        process.on(signal, quit)
    // A native app outlives a fault in it: it is reported, and the window stays.
    process.on('unhandledRejection', reportUnexpected)
    process.on('uncaughtException', reportUnexpected)

    // 38.157.
    if (options.appearance !== 'system')
        send(
            application,
            'setAppearance:',
            send(
                objcClass('NSAppearance'),
                'appearanceNamed:',
                nsString(
                    options.appearance === 'dark'
                        ? 'NSAppearanceNameDarkAqua'
                        : 'NSAppearanceNameAqua',
                ),
            ),
        )

    const window = created('NSWindow')
    const drawnUnder = options.titlebar !== 'standard'
    sendTyped(
        window,
        'setStyleMask:',
        [FFIType.u64],
        FFIType.void,
        TITLED |
            CLOSABLE |
            MINIATURIZABLE |
            // 38.158.
            (options.resizable ? RESIZABLE : 0) |
            // 38.152.
            (drawnUnder ? FULL_SIZE_CONTENT_VIEW : 0),
    )
    if (drawnUnder) {
        sendTyped(
            window,
            'setTitlebarAppearsTransparent:',
            [FFIType.bool],
            FFIType.void,
            true,
        )
        // NSWindowTitleHidden.
        sendTyped(window, 'setTitleVisibility:', [FFIType.i64], FFIType.void, 1)
    }
    // 38.152 — `inset` is the titlebar a unified toolbar makes, with nothing in the toolbar.
    if (options.titlebar === 'inset') {
        const toolbar = created('NSToolbar')
        sendTyped(
            toolbar,
            'setShowsBaselineSeparator:',
            [FFIType.bool],
            FFIType.void,
            false,
        )
        send(window, 'setToolbar:', toolbar)
        sendTyped(
            window,
            'setToolbarStyle:',
            [FFIType.i64],
            FFIType.void,
            UNIFIED_TOOLBAR_STYLE,
        )
    }
    // 38.159.
    sendTyped(
        window,
        'setCollectionBehavior:',
        [FFIType.u64],
        FFIType.void,
        options.fullScreen ? FULL_SCREEN_PRIMARY : FULL_SCREEN_NONE,
    )
    // 38.160.
    if (options.alwaysOnTop)
        sendTyped(
            window,
            'setLevel:',
            [FFIType.i64],
            FFIType.void,
            FLOATING_WINDOW_LEVEL,
        )
    // 38.161.
    if (!options.shadow)
        sendTyped(window, 'setHasShadow:', [FFIType.bool], FFIType.void, false)
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
    // 38.150.
    if (Number.isFinite(options.maxWidth) || Number.isFinite(options.maxHeight))
        sendTyped(
            window,
            'setContentMaxSize:',
            [FFIType.f64, FFIType.f64],
            FFIType.void,
            Math.min(options.maxWidth, Number.MAX_VALUE),
            Math.min(options.maxHeight, Number.MAX_VALUE),
        )
    send(window, 'center')
    // 38.162 — where the window was and how large, as the last launch left it.
    if (options.rememberFrame)
        sendTyped(
            window,
            'setFrameAutosaveName:',
            [FFIType.ptr],
            FFIType.bool,
            nsString(`${appName} window`),
        )
    // 38.156 — the background the last page reported, so the window opens on it rather than a flash.
    const background = session.remembered.background
    if (background !== null && options.vibrancy === undefined)
        send(window, 'setBackgroundColor:', colorOf(background))
    send(window, 'setTitle:', nsString(appName))

    const view = created('WKWebView')
    // 38.163.
    if (options.inspector) {
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
            sendTyped(
                view,
                'setInspectable:',
                [FFIType.bool],
                FFIType.void,
                true,
            )
    }
    const uiDelegate = send(uiDelegateClass(), 'new')
    send(view, 'setUIDelegate:', uiDelegate)
    send(view, 'setNavigationDelegate:', uiDelegate)
    send(view, 'setCustomUserAgent:', nsString(nativeUserAgent(version)))
    if (options.vibrancy === undefined) send(window, 'setContentView:', view)
    else {
        // 38.154 — the material is the content view, and the page is drawn over it with no ground.
        const material = created('NSVisualEffectView')
        sendTyped(
            material,
            'setMaterial:',
            [FFIType.i64],
            FFIType.void,
            VIBRANCY_MATERIALS[options.vibrancy],
        )
        // NSVisualEffectBlendingModeBehindWindow.
        sendTyped(material, 'setBlendingMode:', [FFIType.i64], FFIType.void, 0)
        send(window, 'setContentView:', material)
        send(material, 'addSubview:', view)
        sendTyped(
            view,
            'setTranslatesAutoresizingMaskIntoConstraints:',
            [FFIType.bool],
            FFIType.void,
            false,
        )
        for (const edge of [
            'topAnchor',
            'bottomAnchor',
            'leadingAnchor',
            'trailingAnchor',
        ])
            sendTyped(
                send(
                    send(view, edge),
                    'constraintEqualToAnchor:',
                    send(material, edge),
                ),
                'setActive:',
                [FFIType.bool],
                FFIType.void,
                true,
            )
        send(
            view,
            'setValue:forKey:',
            nsBoolean(false),
            nsString('drawsBackground'),
        )
    }
    send(
        view,
        'loadHTMLString:baseURL:',
        nsString(
            options.vibrancy !== undefined
                ? '<!doctype html>'
                : background !== null
                  ? `<!doctype html><style>:root{background:rgb(${background.join(' ')})}</style>`
                  : '<!doctype html><style>:root{color-scheme:light dark;background:#f5f5f7}@media (prefers-color-scheme:dark){:root{background:#1c1c1e}}</style>',
        ),
        null,
    )

    // 38.153 — WHAT THE PAGE IS TOLD OF ITS TITLEBAR, installed again whenever it changes: at each
    // navigation, once the window has laid out, and at each turn into and out of full screen.
    const controller = send(
        send(view, 'configuration'),
        'userContentController',
    )
    const bridge = `(${windowBridge.toString()})()`
    let fullScreen = false
    const titlebarScript = (): string => {
        let height = 0
        let inset = 0
        if (drawnUnder && !fullScreen) {
            height =
                rectOf(window, 'frame')[3] -
                rectOf(window, 'contentLayoutRect')[3]
            const [zoomX, , zoomWidth] = rectOf(
                windowButton(window, ZOOM_BUTTON),
                'frame',
            )
            // As wide again as the gap the close button keeps from the edge.
            const [margin] = rectOf(windowButton(window, CLOSE_BUTTON), 'frame')
            inset = zoomX + zoomWidth + margin
        }
        return `document.documentElement.style.setProperty('--abide-titlebar-height','${height}px');document.documentElement.style.setProperty('--abide-titlebar-inset','${inset}px')`
    }
    const userScript = (source: string): Id =>
        sendTyped(
            send(objcClass('WKUserScript'), 'alloc'),
            'initWithSource:injectionTime:forMainFrameOnly:',
            [FFIType.ptr, FFIType.i64, FFIType.bool],
            FFIType.ptr,
            nsString(source),
            // WKUserScriptInjectionTimeAtDocumentStart: after the root element exists.
            0,
            true,
        ) as Id
    const tellTitlebar = (): void => {
        const told = titlebarScript()
        send(controller, 'removeAllUserScripts')
        send(controller, 'addUserScript:', userScript(bridge))
        send(controller, 'addUserScript:', userScript(told))
        send(
            view,
            'evaluateJavaScript:completionHandler:',
            nsString(told),
            null,
        )
    }
    send(
        controller,
        'addScriptMessageHandler:name:',
        send(
            definedClass('AbideWindowBridge', {
                'userContentController:didReceiveScriptMessage:': {
                    types: 'v@:@@',
                    args: [FFIType.ptr, FFIType.ptr],
                    returns: FFIType.void,
                    run: (_controller: Id, message: Id) => {
                        const [kind, ...rest] = stringOf(
                            send(message, 'body'),
                        ).split(' ')
                        // 38.155 — the press that posted this is the event AppKit is handling.
                        if (kind === 'drag') {
                            const event = send(application, 'currentEvent')
                            if (event !== null)
                                send(
                                    window,
                                    'performWindowDragWithEvent:',
                                    event,
                                )
                        } else if (kind === 'zoom') titlebarDoubleClick(window)
                        // 38.156.
                        else if (
                            kind === 'background' &&
                            options.vibrancy === undefined
                        ) {
                            const color = rest.map(Number) as [
                                number,
                                number,
                                number,
                            ]
                            send(window, 'setBackgroundColor:', colorOf(color))
                            session
                                .rememberBackground(color)
                                .catch(reportUnexpected)
                        }
                    },
                },
            }),
            'new',
        ),
        nsString('abideWindow'),
    )
    const fullScreenChanged = (entered: boolean) => (): void => {
        fullScreen = entered
        tellTitlebar()
    }
    send(
        window,
        'setDelegate:',
        send(
            definedClass('AbideWindowDelegate', {
                'windowDidEnterFullScreen:': {
                    types: 'v@:@',
                    args: [FFIType.ptr],
                    returns: FFIType.void,
                    run: fullScreenChanged(true),
                },
                'windowDidExitFullScreen:': {
                    types: 'v@:@',
                    args: [FFIType.ptr],
                    returns: FFIType.void,
                    run: fullScreenChanged(false),
                },
            }),
            'new',
        ),
    )
    // 38.88 — THE MENU BAR IS THE PAGE'S: the defaults until the page the window loads tells it
    // what its route exports, and again after every navigation it makes.
    // 38.148 — EVERY PAGE THE APP SHOWS HEARS OF AN UPDATE: the window's, and the menu bar extra's
    // panel's once it is built. Each asks on load and is told again when one is staged.
    const updateViews: Id[] = []
    let updateBridge: Id = null
    const connectUpdates = (target: Id): void => {
        updateViews.push(target)
        updateBridge ??= send(
            definedClass('AbideUpdateBridge', {
                'userContentController:didReceiveScriptMessage:': {
                    types: 'v@:@@',
                    args: [FFIType.ptr, FFIType.ptr],
                    returns: FFIType.void,
                    run: (_controller: Id, message: Id) => {
                        const asked = stringOf(send(message, 'body'))
                        if (asked === 'ask') tellPage()
                        else if (
                            asked === 'install' &&
                            updater?.staged !== undefined
                        )
                            restart()
                    },
                },
            }),
            'new',
        )
        send(
            send(send(target, 'configuration'), 'userContentController'),
            'addScriptMessageHandler:name:',
            updateBridge,
            nsString('abideUpdate'),
        )
    }
    // 38.166.
    const extra = options.menuBarExtra
        ? openMenuBarExtra(
              appName,
              version,
              menuBarIcon,
              options,
              window,
              uiDelegate,
              () => session.shown,
              connectUpdates,
          )
        : undefined
    let shownMenu: NativeMenuItem[] = []
    const showMenu = (told: NativeMenuItem[]): void => {
        shownMenu = told
        const built = installMenu(
            menuBar(appName, options.connect, told, updateLabel()),
            choose,
            // 38.170.
            extra === undefined
                ? undefined
                : [
                      ...told,
                      ...(told.length === 0 ? [] : (['separator'] as const)),
                      { label: `Quit ${appName}`, role: 'quit', key: 'cmd+q' },
                  ],
        )
        extra?.setMenu(built)
    }
    const choose = (item: Exclude<NativeMenuItem, 'separator'>): void => {
        if (item.role === 'update') return checkForUpdates()
        if (item.role === 'connect') return navigate(`${base}?focus=connect`)
        // 38.74.
        if (item.role === 'disconnect')
            return void session.forget().then(() => navigate(base))
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
    }
    const updateLabel = (): string | undefined =>
        updater === undefined
            ? undefined
            : updater.staged === undefined
              ? 'Check for Updates…'
              : `Restart to Install ${updater.staged.version}`
    // 38.148 — what the page's `pendingUpdate` holds: the staged update, or nothing.
    const tellPage = (): void => {
        const staged = updater?.staged
        const detail =
            staged === undefined
                ? null
                : {
                      version: staged.version,
                      required: staged.required,
                      notes: staged.notes,
                  }
        for (const told of updateViews)
            send(
                told,
                'evaluateJavaScript:completionHandler:',
                nsString(
                    `dispatchEvent(new CustomEvent('abide:update', { detail: ${JSON.stringify(detail)} }))`,
                ),
                null,
            )
    }
    // 38.145 — a staged update is installed by restarting; with none, the feed is read now and
    // the person told what it found.
    const checkForUpdates = (): void => {
        if (updater === undefined) return
        if (updater.staged !== undefined) return restart()
        void updater.check().then((checked) => {
            if (checked.outcome === 'current')
                alert(
                    nsString(`${appName} ${version} is the latest version.`),
                    false,
                )
            else if (checked.outcome === 'unreachable')
                alert(
                    nsString(
                        `Updates could not be checked. ${checked.reason}.`,
                    ),
                    false,
                )
            else if (checked.outcome === 'refused') {
                reportUnexpected(
                    new Error(`abide: ${checked.reason}. RULEBOOK 38.143.`),
                )
                alert(
                    nsString(`The update was refused: ${checked.reason}.`),
                    false,
                )
            } else if (
                alert(
                    nsString(
                        `${appName} ${checked.staged.version} is ready. Restart to install it now?`,
                    ),
                    true,
                )
            )
                restart()
        })
    }
    if (updater !== undefined)
        updater.onStaged = () => {
            showMenu(shownMenu)
            tellPage()
        }
    connectUpdates(view)
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
                                ) as NativeMenuItem[],
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
        tellTitlebar()
        extra?.closePanel()
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
    return navigate
}

// What a page asks of its window: a link out opens in the browser, one of a scheme the web view
// cannot load opens in the app that takes it, and `alert` and `confirm` are sheets the page waits on.
// The window's and the panel's web views take one of these as their UI delegate and their
// navigation delegate alike.
let uiDelegate: Id = null
function uiDelegateClass(): Id {
    uiDelegate ??= definedClass('AbideUIDelegate', {
        // 38.174 — WebKit fails a navigation to a scheme it has no loader for, where a browser hands it
        // to the system: an `abide-bridge:` link (44.70), `mailto:`, an app's own.
        'webView:decidePolicyForNavigationAction:decisionHandler:': {
            types: 'v@:@@@?',
            args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
            returns: FFIType.void,
            run: (_view: Id, action: Id, decide: Id) => {
                const url = send(send(action, 'request'), 'URL')
                const scheme = url === null ? '' : stringOf(send(url, 'scheme'))
                const loads = url === null || WEB_SCHEMES.has(scheme)
                if (!loads)
                    send(
                        send(objcClass('NSWorkspace'), 'sharedWorkspace'),
                        'openURL:',
                        url,
                    )
                // WKNavigationActionPolicyAllow, or Cancel.
                callBlock(decide, [FFIType.i64], loads ? 1 : 0)
            },
        },
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

// What the web view loads itself; any other scheme is the system's to open.
const WEB_SCHEMES = new Set(['http', 'https', 'about', 'blob', 'data', 'file'])

function windowButton(window: Id, button: number): Id {
    return sendTyped(
        window,
        'standardWindowButton:',
        [FFIType.u64],
        FFIType.ptr,
        button,
    ) as Id
}

/** An opaque `NSColor` of sRGB bytes. */
function colorOf([red, green, blue]: [number, number, number]): Id {
    return sendTyped(
        objcClass('NSColor'),
        'colorWithSRGBRed:green:blue:alpha:',
        [FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64],
        FFIType.ptr,
        red / 255,
        green / 255,
        blue / 255,
        1,
    ) as Id
}

/** 38.155 — what a double press on the titlebar does, as the system's setting for it names. */
function titlebarDoubleClick(window: Id): void {
    const action = stringOf(
        send(
            send(objcClass('NSUserDefaults'), 'standardUserDefaults'),
            'stringForKey:',
            nsString('AppleActionOnDoubleClick'),
        ),
    )
    if (action === 'None') return
    send(
        window,
        action === 'Minimize' ? 'performMiniaturize:' : 'performZoom:',
        null,
    )
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
