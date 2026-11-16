// 38.70 — THE WINDOW `abide native`'S EXECUTABLE OPENS, over AppKit through `bun:ffi`: a WKWebView and
// the page's menu bar, on the main thread, which sleeps in AppKit's wait (`appKitLoop`). What it
// shows is the launcher's thread's to decide, and everything that needs bun's own loop — the
// session, the updater, a fetch — is asked of that thread rather than done here.

import { FFIType } from 'bun:ffi'

import type { NativeMenuItem } from '#shared/menuItem.ts'

import {
    blockOnce,
    callBlock,
    callBlockLater,
    created,
    definedClass,
    flagOf,
    type Id,
    nsBoolean,
    nsString,
    objcClass,
    rectOf,
    selector,
    send,
    sendFlag,
    sendNumber,
    sendPair,
    sendTyped,
    stringOf,
    windowButton,
} from './appKit.ts'
import { onSignal, sleepInAppKit } from './appKitLoop.ts'
import { installMenu } from './installMenu.ts'
import { type Launcher, VIBRANCY_MATERIALS } from './launcherOptions.ts'
import { menuBar, menuBarExtraMenu, opensInWindow } from './menuBar.ts'
import { type MenuBarIcon, openMenuBarExtra } from './menuBarExtra.ts'
import {
    closeNotification,
    hearNotifications,
    notificationCenter,
    showNotification,
} from './nativeNotifications.ts'
import type { Checked, Staged } from './NativeUpdater.ts'
import { nativeUserAgent } from './nativeUserAgent.ts'
import { pageBridge } from './pageBridge.ts'
import { windowBridge } from './windowBridge.ts'

const SIGINT = 2
const SIGTERM = 15
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

/** What the window reaches of the launcher's thread, which holds the session and the updater. */
export type LauncherThread = {
    /** The address of the app the window shows, `undefined` while it shows the launcher. */
    readonly shown: string | undefined
    /** 38.142 — `undefined` where nothing is checked for; `onStaged` is the window's to set. */
    readonly updates:
        | {
              staged: Staged | undefined
              check(): Promise<Checked>
              onStaged: () => void
          }
        | undefined
    /** 38.74. */
    forget(): Promise<void>
    /** Whether the app at `address` answers it. */
    hasPage(address: string): Promise<boolean>
    /** 38.190 — asks the person to allow notifications, answering whether they are. */
    requestNotifications(): Promise<boolean>
    /** 38.156. */
    rememberBackground(color: [number, number, number]): void
    /**
     * 38.76 — stops the app, installs what was staged (38.144), opens it where `reopen` (38.145),
     * and then ends the process.
     */
    quit(reopen: boolean): void
    report(error: unknown): void
}

/**
 * Opens the app's window on a blank page, hands the main thread to AppKit, and answers how to
 * point the window at an address.
 *
 * `base` is the launcher's own page, which the Connect… and Disconnect menu items lead back to,
 * and `version` the `.app`'s, which every request the window makes names (38.140). `background`
 * is the one the last page reported (38.156).
 */
export function openNativeWindow(
    appName: string,
    version: string,
    options: Launcher,
    base: string,
    background: [number, number, number] | null,
    launcher: LauncherThread,
    menuBarIcon: MenuBarIcon | undefined,
): (address: string) => void {
    const application = send(objcClass('NSApplication'), 'sharedApplication')
    // Regular: a Dock icon and a menu bar, which a process outside a `.app` does not get by default.
    // 38.165 — accessory: neither.
    const showDock = (shown: boolean): void => {
        sendNumber(application, 'setActivationPolicy:', shown ? 0 : 1)
    }
    // 38.183 — the window opens shown, and its Dock icon with it.
    showDock(options.dock !== false)
    let quitting = false
    // 38.145 — `reopen` for a restart the person asked for, so the update installed is opened.
    const quit = (reopen = false): void => {
        if (quitting) return
        quitting = true
        launcher.quit(reopen)
    }
    const restart = (): void => quit(true)
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
                        if (!visible) front()
                        return true
                    },
                },
            }),
            'new',
        ),
    )
    for (const signal of [SIGTERM, SIGINT]) onSignal(signal, () => quit())
    // A native app outlives a fault in it: it is reported, and the window stays.
    process.on('unhandledRejection', launcher.report)
    process.on('uncaughtException', launcher.report)

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
    sendNumber(
        window,
        'setStyleMask:',
        TITLED |
            CLOSABLE |
            MINIATURIZABLE |
            // 38.158.
            (options.resizable ? RESIZABLE : 0) |
            // 38.152.
            (drawnUnder ? FULL_SIZE_CONTENT_VIEW : 0),
        FFIType.u64,
    )
    if (drawnUnder) {
        sendFlag(window, 'setTitlebarAppearsTransparent:', true)
        // NSWindowTitleHidden.
        sendNumber(window, 'setTitleVisibility:', 1)
    }
    // 38.152 — `inset` is the titlebar a unified toolbar makes, with nothing in the toolbar.
    if (options.titlebar === 'inset') {
        const toolbar = created('NSToolbar')
        sendFlag(toolbar, 'setShowsBaselineSeparator:', false)
        send(window, 'setToolbar:', toolbar)
        sendNumber(window, 'setToolbarStyle:', UNIFIED_TOOLBAR_STYLE)
    }
    // 38.159.
    sendNumber(
        window,
        'setCollectionBehavior:',
        options.fullScreen ? FULL_SCREEN_PRIMARY : FULL_SCREEN_NONE,
        FFIType.u64,
    )
    // 38.160.
    if (options.alwaysOnTop)
        sendNumber(window, 'setLevel:', FLOATING_WINDOW_LEVEL)
    // 38.161.
    if (!options.shadow) sendFlag(window, 'setHasShadow:', false)
    sendFlag(window, 'setReleasedWhenClosed:', false)
    sendPair(window, 'setContentSize:', options.width, options.height)
    sendPair(window, 'setContentMinSize:', options.minWidth, options.minHeight)
    // 38.150.
    if (Number.isFinite(options.maxWidth) || Number.isFinite(options.maxHeight))
        sendPair(
            window,
            'setContentMaxSize:',
            Math.min(options.maxWidth, Number.MAX_VALUE),
            Math.min(options.maxHeight, Number.MAX_VALUE),
        )
    send(window, 'center')
    // 38.162 — where the window was and how large, as the last launch left it.
    if (options.rememberFrame)
        flagOf(window, 'setFrameAutosaveName:', nsString(`${appName} window`))
    // 38.156 — the background the last page reported, so the window opens on it rather than a flash.
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
        if (flagOf(view, 'respondsToSelector:', selector('setInspectable:')))
            sendFlag(view, 'setInspectable:', true)
    }
    const uiDelegate = send(uiDelegateClass(), 'new')
    send(view, 'setUIDelegate:', uiDelegate)
    send(view, 'setNavigationDelegate:', uiDelegate)
    send(
        view,
        'setCustomUserAgent:',
        nsString(nativeUserAgent(version, appName)),
    )
    // The window is titled by the page it shows, told by the web view as its title changes.
    sendTyped(
        view,
        'addObserver:forKeyPath:options:context:',
        [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
        FFIType.void,
        send(
            definedClass('AbideTitleObserver', {
                'observeValueForKeyPath:ofObject:change:context:': {
                    types: 'v@:@@@^v',
                    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
                    returns: FFIType.void,
                    run: () =>
                        send(
                            window,
                            'setTitle:',
                            nsString(stringOf(send(view, 'title')) || appName),
                        ),
                },
            }),
            'new',
        ),
        nsString('title'),
        0,
        null,
    )
    if (options.vibrancy === undefined) send(window, 'setContentView:', view)
    else {
        // 38.154 — the material is the content view, and the page is drawn over it with no ground.
        const material = created('NSVisualEffectView')
        sendNumber(
            material,
            'setMaterial:',
            VIBRANCY_MATERIALS[options.vibrancy],
        )
        // NSVisualEffectBlendingModeBehindWindow.
        sendNumber(material, 'setBlendingMode:', 0)
        send(window, 'setContentView:', material)
        send(material, 'addSubview:', view)
        sendFlag(view, 'setTranslatesAutoresizingMaskIntoConstraints:', false)
        for (const edge of [
            'topAnchor',
            'bottomAnchor',
            'leadingAnchor',
            'trailingAnchor',
        ])
            sendFlag(
                send(
                    send(view, edge),
                    'constraintEqualToAnchor:',
                    send(material, edge),
                ),
                'setActive:',
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
        send(controller, 'addUserScript:', userScript(pageScript()))
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
        scriptHandler('AbideWindowBridge', (body) => {
            const [kind, rest] = kindAndRest(body)
            // 38.155 — the press that posted this is the event AppKit is handling.
            if (kind === 'drag') {
                const event = send(application, 'currentEvent')
                if (event !== null)
                    send(window, 'performWindowDragWithEvent:', event)
            } else if (kind === 'zoom') titlebarDoubleClick(window)
            // 38.156.
            else if (kind === 'background' && options.vibrancy === undefined) {
                const color = rest.split(' ').map(Number) as [
                    number,
                    number,
                    number,
                ]
                send(window, 'setBackgroundColor:', colorOf(color))
                launcher.rememberBackground(color)
            }
        }),
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
                // The web view sets the cursor only when the page's cursor changes, so the edge's
                // resize arrows outlast a resize until the pointer crosses an element that has one.
                // 38.183 — every way the window goes — its close button, Close Window, Quit
                // (38.184), the menu bar extra (38.169) — closes it, and its Dock icon goes with it.
                'windowWillClose:': {
                    types: 'v@:@',
                    args: [FFIType.ptr],
                    returns: FFIType.void,
                    run: () => {
                        if (options.dock === 'window') showDock(false)
                    },
                },
                'windowDidEndLiveResize:': {
                    types: 'v@:@',
                    args: [FFIType.ptr],
                    returns: FFIType.void,
                    run: () => {
                        send(send(objcClass('NSCursor'), 'arrowCursor'), 'set')
                        send(window, 'invalidateCursorRectsForView:', view)
                    },
                },
            }),
            'new',
        ),
    )
    // 38.88 — THE MENU BAR IS THE PAGE'S: the defaults until the page the window loads tells it
    // what its route exports, and again after every navigation it makes.
    // 38.148 — EVERY PAGE THE APP SHOWS HEARS OF AN UPDATE: the window's, and the menu bar extra's
    // panel's once it is built. Each asks on load and is told again when one is staged.
    // 38.188-38.190 — and each has the badge, `print` and `Notification` of `pageBridge`.
    const updateViews: Id[] = []
    let updateBridge: Id = null
    const dockTile = send(application, 'dockTile')
    const setBadge = (label: string): void => {
        send(
            dockTile,
            'setBadgeLabel:',
            label === '' ? null : nsString(label === 'flag' ? '•' : label),
        )
    }
    // 38.190 — what the person last answered, kept with the app's settings; `denied` where the
    // process is no `.app`, which has no notifications.
    const center = notificationCenter()
    const defaults = send(objcClass('NSUserDefaults'), 'standardUserDefaults')
    const permissionKey = nsString('AbideNotificationPermission')
    let permission: NotificationPermission =
        center === null
            ? 'denied'
            : ((stringOf(send(defaults, 'stringForKey:', permissionKey)) ||
                  'default') as NotificationPermission)
    const pageScript = (): string =>
        `(${pageBridge.toString()})(${JSON.stringify(permission)})`
    const tellPages = (type: string, detail: unknown): void => {
        for (const told of updateViews)
            send(
                told,
                'evaluateJavaScript:completionHandler:',
                nsString(
                    `dispatchEvent(new CustomEvent('abide:${type}', { detail: ${JSON.stringify(detail)} }))`,
                ),
                null,
            )
    }
    const answerPermission = (granted: boolean): void => {
        permission = granted ? 'granted' : 'denied'
        if (center !== null)
            send(
                defaults,
                'setObject:forKey:',
                nsString(permission),
                permissionKey,
            )
        // The next page each view loads is told it from the start: the window's at each
        // navigation (`tellTitlebar`), the panel's here.
        for (const told of updateViews) {
            if (told === view) continue
            const panelController = send(
                send(told, 'configuration'),
                'userContentController',
            )
            send(panelController, 'removeAllUserScripts')
            send(panelController, 'addUserScript:', userScript(pageScript()))
        }
        tellTitlebar()
        tellPages('permission', permission)
    }
    if (center !== null)
        hearNotifications(center, (id) => {
            front()
            tellPages('notification', { id, type: 'click' })
        })
    const pageHandler = scriptHandler('AbidePageBridge', (body, message) => {
        const [kind, rest] = kindAndRest(body)
        if (kind === 'badge') setBadge(rest)
        // 38.189.
        else if (kind === 'print') printPage(send(message, 'webView'))
        else if (kind === 'permission') {
            if (center === null) answerPermission(false)
            else void launcher.requestNotifications().then(answerPermission)
        } else if (kind === 'notify' && center !== null)
            showNotification(center, JSON.parse(rest))
        else if (kind === 'close' && center !== null)
            closeNotification(center, rest)
    })
    const connectPage = (target: Id): void => {
        updateViews.push(target)
        const pageController = send(
            send(target, 'configuration'),
            'userContentController',
        )
        send(
            pageController,
            'addScriptMessageHandler:name:',
            pageHandler,
            nsString('abidePage'),
        )
        send(pageController, 'addUserScript:', userScript(pageScript()))
        // 38.191.
        sendFlag(
            send(send(target, 'configuration'), 'preferences'),
            'setElementFullscreenEnabled:',
            true,
        )
        updateBridge ??= scriptHandler('AbideUpdateBridge', (asked) => {
            if (asked === 'ask') tellPage()
            else if (asked === 'install' && updates?.staged !== undefined)
                restart()
        })
        send(
            pageController,
            'addScriptMessageHandler:name:',
            updateBridge,
            nsString('abideUpdate'),
        )
    }
    // Shows the window where it is hidden, in front of every other app's.
    const front = (): void => {
        // 38.183 — before activating, so the app comes forward with its menu bar.
        if (options.dock === 'window') showDock(true)
        sendFlag(application, 'activateIgnoringOtherApps:', true)
        send(window, 'makeKeyAndOrderFront:', null)
    }
    const updates = launcher.updates
    // 38.166.
    const extra = options.menuBarExtra
        ? openMenuBarExtra(
              appName,
              version,
              menuBarIcon,
              options,
              window,
              uiDelegate,
              () => launcher.shown,
              launcher.hasPage,
              connectPage,
              front,
          )
        : undefined
    let shownMenu: NativeMenuItem[] = []
    const showMenu = (told: NativeMenuItem[]): void => {
        shownMenu = told
        const built = installMenu(
            menuBar(
                appName,
                options.connect,
                told,
                updateLabel(),
                options.dock === 'window',
            ),
            choose,
            // 38.170.
            extra === undefined ? undefined : menuBarExtraMenu(appName, told),
        )
        extra?.setMenu(built)
    }
    const choose = (item: Exclude<NativeMenuItem, 'separator'>): void => {
        if (item.role === 'update') return checkForUpdates()
        if (item.role === 'connect') return navigate(`${base}?focus=connect`)
        // 38.74.
        if (item.role === 'disconnect')
            return void launcher.forget().then(() => navigate(base))
        if (item.role === 'reload') return void send(view, 'reload')
        if (item.role === 'window') return front()
        // 38.184.
        if (item.role === 'closeWindow') return void send(window, 'close')
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
        updates === undefined
            ? undefined
            : updates.staged === undefined
              ? 'Check for Updates…'
              : `Restart to Install ${updates.staged.version}`
    // 38.148 — what the page's `pendingUpdate` holds: the staged update, or nothing.
    const tellPage = (): void => {
        const staged = updates?.staged
        const detail =
            staged === undefined
                ? null
                : {
                      version: staged.version,
                      required: staged.required,
                      notes: staged.notes,
                  }
        tellPages('update', detail)
    }
    // 38.145 — a staged update is installed by restarting; with none, the feed is read now and
    // the person told what it found.
    const checkForUpdates = (): void => {
        if (updates === undefined) return
        if (updates.staged !== undefined) return restart()
        void updates.check().then((checked) => {
            // 38.178 — told on the window, brought forward to be read.
            front()
            if (checked.outcome === 'current')
                ask(
                    window,
                    nsString(`${appName} ${version} is the latest version.`),
                    false,
                )
            else if (checked.outcome === 'unreachable')
                ask(
                    window,
                    nsString(
                        `Updates could not be checked. ${checked.reason}.`,
                    ),
                    false,
                )
            // 38.143 — reported by the launcher's thread, which read it.
            else if (checked.outcome === 'refused')
                ask(
                    window,
                    nsString(`The update was refused: ${checked.reason}.`),
                    false,
                )
            else
                ask(
                    window,
                    nsString(
                        `${appName} ${checked.staged.version} is ready. Restart to install it now?`,
                    ),
                    true,
                    (accepted) => {
                        if (accepted) restart()
                    },
                )
        })
    }
    if (updates !== undefined)
        updates.onStaged = () => {
            showMenu(shownMenu)
            tellPage()
        }
    connectPage(view)
    send(
        controller,
        'addScriptMessageHandler:name:',
        scriptHandler('AbideMenuBridge', (body) => {
            try {
                showMenu(JSON.parse(body) as NativeMenuItem[])
            } catch (thrown) {
                launcher.report(thrown)
            }
        }),
        nsString('abideMenu'),
    )
    const navigate = (address: string): void => {
        // 38.92.
        showMenu([])
        // 38.188 — the launcher's page sets no badge, and the app it leaves keeps none.
        if (address.startsWith(base)) setBadge('')
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
    // 38.176 — a new window asked for onto the app the window shows is the window, brought forward.
    showInWindow = (address) => {
        if (!opensInWindow(address, launcher.shown)) return false
        navigate(address)
        front()
        return true
    }

    front()
    send(application, 'finishLaunching')

    sleepInAppKit(application)
    return navigate
}

// What a page asks of its window: a link out opens in the browser, one of a scheme the web view
// cannot load opens in the app that takes it, `alert`, `confirm` and `prompt` are sheets the page
// waits on (38.178), a download is saved (38.192) and a file input opens the open panel (38.193).
// The window's and the panel's web views take one of these as their UI delegate and their
// navigation delegate alike.
let uiDelegate: Id = null
// What the window does with an address a page asks to open in a new window: shows it, and answers
// `true`, where it is the app the window shows. 38.176.
let showInWindow: (address: string) => boolean = () => false
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
                // WKNavigationActionPolicyDownload for a link marked `download` (38.192), else
                // Allow, or Cancel.
                callBlock(
                    decide,
                    [FFIType.i64],
                    !loads
                        ? 0
                        : flagOf(action, 'shouldPerformDownload')
                          ? 2
                          : 1,
                )
            },
        },
        // 38.192 — an answer the web view cannot show, or one sent as an attachment, is saved.
        'webView:decidePolicyForNavigationResponse:decisionHandler:': {
            types: 'v@:@@@?',
            args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
            returns: FFIType.void,
            run: (_view: Id, navigation: Id, decide: Id) => {
                const response = send(navigation, 'response')
                const disposition = flagOf(
                    response,
                    'isKindOfClass:',
                    objcClass('NSHTTPURLResponse'),
                )
                    ? stringOf(
                          send(
                              response,
                              'valueForHTTPHeaderField:',
                              nsString('Content-Disposition'),
                          ),
                      )
                    : ''
                const saved =
                    /^\s*attachment/i.test(disposition) ||
                    !flagOf(navigation, 'canShowMIMEType')
                // WKNavigationResponsePolicyDownload, or Allow.
                callBlock(decide, [FFIType.i64], saved ? 2 : 1)
            },
        },
        'webView:navigationAction:didBecomeDownload:': {
            types: 'v@:@@@',
            args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
            returns: FFIType.void,
            run: (_view: Id, _action: Id, download: Id) =>
                send(download, 'setDelegate:', downloadDelegate()),
        },
        'webView:navigationResponse:didBecomeDownload:': {
            types: 'v@:@@@',
            args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
            returns: FFIType.void,
            run: (_view: Id, _response: Id, download: Id) =>
                send(download, 'setDelegate:', downloadDelegate()),
        },
        // 38.193 — a file input opens the platform's open panel, a sheet on the window it is in.
        'webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:':
            {
                types: 'v@:@@@@?',
                args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
                returns: FFIType.void,
                run: (view: Id, parameters: Id, _frame: Id, done: Id) => {
                    const answer = callBlockLater(done)
                    const panel = send(
                        send(objcClass('NSOpenPanel'), 'openPanel'),
                        'retain',
                    )
                    sendFlag(panel, 'setCanChooseFiles:', true)
                    sendFlag(
                        panel,
                        'setCanChooseDirectories:',
                        flagOf(parameters, 'allowsDirectories'),
                    )
                    sendFlag(
                        panel,
                        'setAllowsMultipleSelection:',
                        flagOf(parameters, 'allowsMultipleSelection'),
                    )
                    send(
                        panel,
                        'beginSheetModalForWindow:completionHandler:',
                        send(view, 'window'),
                        // NSModalResponseOK.
                        blockOnce([FFIType.i64], (response: bigint) => {
                            answer(
                                [FFIType.ptr],
                                Number(response) === 1
                                    ? send(panel, 'URLs')
                                    : null,
                            )
                            send(panel, 'release')
                        }),
                    )
                },
            },
        'webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:':
            {
                types: '@@:@@@@',
                args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
                returns: FFIType.ptr,
                run: (_view: Id, _configuration: Id, action: Id) => {
                    const url = send(send(action, 'request'), 'URL')
                    if (
                        url !== null &&
                        !showInWindow(stringOf(send(url, 'absoluteString')))
                    )
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
                run: (view: Id, message: Id, _frame: Id, done: Id) => {
                    const answer = callBlockLater(done)
                    ask(send(view, 'window'), message, false, () => answer([]))
                },
            },
        'webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:':
            {
                types: 'v@:@@@@?',
                args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
                returns: FFIType.void,
                run: (view: Id, message: Id, _frame: Id, done: Id) => {
                    const answer = callBlockLater(done)
                    ask(send(view, 'window'), message, true, (accepted) =>
                        answer([FFIType.bool], accepted),
                    )
                },
            },
        'webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:':
            {
                types: 'v@:@@@@@?',
                args: [
                    FFIType.ptr,
                    FFIType.ptr,
                    FFIType.ptr,
                    FFIType.ptr,
                    FFIType.ptr,
                ],
                returns: FFIType.void,
                run: (
                    view: Id,
                    message: Id,
                    given: Id,
                    _frame: Id,
                    done: Id,
                ) => {
                    const answer = callBlockLater(done)
                    ask(
                        send(view, 'window'),
                        message,
                        true,
                        (accepted, text) =>
                            answer(
                                [FFIType.ptr],
                                accepted ? nsString(text) : null,
                            ),
                        stringOf(given),
                    )
                },
            },
    })
    return uiDelegate
}

// What the web view loads itself; any other scheme is the system's to open.
const WEB_SCHEMES = new Set(['http', 'https', 'about', 'blob', 'data', 'file'])

/** An opaque `NSColor` of sRGB bytes. */
/**
 * A new instance of a `WKScriptMessageHandler` class named `className`, handing `hear` each message's
 * body as text, and the message itself.
 */
function scriptHandler(
    className: string,
    hear: (body: string, message: Id) => void,
): Id {
    return send(
        definedClass(className, {
            'userContentController:didReceiveScriptMessage:': {
                types: 'v@:@@',
                args: [FFIType.ptr, FFIType.ptr],
                returns: FFIType.void,
                run: (_controller: Id, message: Id) =>
                    hear(stringOf(send(message, 'body')), message),
            },
        }),
        'new',
    )
}

/** A bridge message's kind — its first word — and the rest of it, `''` where there is none. */
function kindAndRest(body: string): [kind: string, rest: string] {
    const space = body.indexOf(' ')
    return space === -1
        ? [body, '']
        : [body.slice(0, space), body.slice(space + 1)]
}

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

let downloads: Id = null
// 38.192 — where each download is going, by the download, to be told the Downloads stack once there.
const DOWNLOADING = new Map<Id, string>()
function downloadDelegate(): Id {
    downloads ??= send(
        definedClass('AbideDownloadDelegate', {
            'download:decideDestinationUsingResponse:suggestedFilename:completionHandler:':
                {
                    types: 'v@:@@@@?',
                    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
                    returns: FFIType.void,
                    run: (download: Id, _response: Id, name: Id, done: Id) => {
                        const path = freePath(
                            `${Bun.env.HOME}/Downloads`,
                            stringOf(name) || 'download',
                        )
                        DOWNLOADING.set(download, path)
                        callBlock(
                            done,
                            [FFIType.ptr],
                            send(
                                objcClass('NSURL'),
                                'fileURLWithPath:',
                                nsString(path),
                            ),
                        )
                    },
                },
            'downloadDidFinish:': {
                types: 'v@:@',
                args: [FFIType.ptr],
                returns: FFIType.void,
                run: (download: Id) => {
                    const path = DOWNLOADING.get(download)
                    DOWNLOADING.delete(download)
                    if (path === undefined) return
                    // What bounces the Downloads stack in the Dock.
                    send(
                        send(
                            objcClass('NSDistributedNotificationCenter'),
                            'defaultCenter',
                        ),
                        'postNotificationName:object:',
                        nsString('com.apple.DownloadFileFinished'),
                        nsString(path),
                    )
                },
            },
            'download:didFailWithError:resumeData:': {
                types: 'v@:@@@',
                args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
                returns: FFIType.void,
                run: (download: Id, error: Id) => {
                    const path = DOWNLOADING.get(download) ?? ''
                    DOWNLOADING.delete(download)
                    ask(
                        send(send(download, 'webView'), 'window'),
                        nsString(
                            `${path.slice(path.lastIndexOf('/') + 1) || 'The file'} could not be downloaded. ${stringOf(send(error, 'localizedDescription'))}`,
                        ),
                        false,
                    )
                },
            },
        }),
        'new',
    )
    return downloads
}

/** `name` in `directory`, numbered as the Finder numbers a copy where the name is taken. */
function freePath(directory: string, name: string): string {
    const files = send(objcClass('NSFileManager'), 'defaultManager')
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const extension = dot > 0 ? name.slice(dot) : ''
    let path = `${directory}/${name}`
    for (
        let copy = 2;
        flagOf(files, 'fileExistsAtPath:', nsString(path));
        copy += 1
    )
        path = `${directory}/${stem} ${copy}${extension}`
    return path
}

/** 38.189 — the page the web view shows, in the platform's print panel as a sheet on its window. */
function printPage(view: Id): void {
    if (view === null) return
    const operation = send(
        view,
        'printOperationWithPrintInfo:',
        send(objcClass('NSPrintInfo'), 'sharedPrintInfo'),
    )
    // The operation's view is made with no size, and a view of no size prints blank pages.
    const [, , width, height] = rectOf(view, 'frame')
    sendPair(send(operation, 'view'), 'setFrameSize:', width, height)
    sendTyped(
        operation,
        'runOperationModalForWindow:delegate:didRunSelector:contextInfo:',
        [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
        FFIType.void,
        send(view, 'window'),
        null,
        null,
        null,
    )
}

// 38.178 — an `NSAlert` with `message`, a sheet on `window`; `answered` hears whether it was
// accepted, and what its field holds where it has one — given `field`, its text to start with.
function ask(
    window: Id,
    message: Id,
    cancellable: boolean,
    answered: (accepted: boolean, text: string) => void = () => {},
    field?: string,
): void {
    const panel = created('NSAlert')
    send(panel, 'setMessageText:', message)
    send(panel, 'addButtonWithTitle:', nsString('OK'))
    if (cancellable) send(panel, 'addButtonWithTitle:', nsString('Cancel'))
    const input =
        field === undefined
            ? null
            : send(
                  objcClass('NSTextField'),
                  'textFieldWithString:',
                  nsString(field),
              )
    if (input !== null) {
        sendPair(input, 'setFrameSize:', 260, 24)
        send(panel, 'setAccessoryView:', input)
        send(panel, 'layout')
        send(send(panel, 'window'), 'setInitialFirstResponder:', input)
    }
    send(
        panel,
        'beginSheetModalForWindow:completionHandler:',
        window,
        // NSAlertFirstButtonReturn.
        blockOnce([FFIType.i64], (response: bigint) =>
            answered(
                Number(response) === 1000,
                input === null ? '' : stringOf(send(input, 'stringValue')),
            ),
        ),
    )
}
