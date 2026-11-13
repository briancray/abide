// 38.70 — THE WINDOW `abide bundle`'S EXECUTABLE OPENS, over AppKit through `bun:ffi`: a WKWebView, the
// page's menu bar and an event drain. What it shows is the `DesktopSession`'s to decide.
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
    selector,
    send,
    sendTyped,
    stringOf,
} from './appKit.ts'
import type { DesktopSession } from './DesktopSession.ts'
import { desktopUserAgent } from './desktopUserAgent.ts'
import { reportUnexpected } from './hooks.ts'
import type { Launcher } from './launcherOptions.ts'
import { installMenu, menuBar } from './nativeMenu.ts'

const DRAIN_MILLISECONDS = 8

/**
 * Opens the app's window on a blank page and answers how to point it at an address.
 *
 * `base` is the launcher's own page, which the Connect… and Disconnect menu items lead back to,
 * and `version` the `.app`'s, which every request the window makes names (38.140). Quitting stops
 * the session's app before the process ends (38.76).
 */
export function openDesktopWindow(
    appName: string,
    version: string,
    options: Launcher,
    base: string,
    session: DesktopSession,
): (address: string) => void {
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
        session.disconnect().finally(() => process.exit(0))
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
    send(view, 'setCustomUserAgent:', nsString(desktopUserAgent(version)))
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
    const showMenu = (told: NativeMenuItem[]): void =>
        installMenu(menuBar(appName, options.connect, told), (item) => {
            if (item.role === 'connect')
                return navigate(`${base}?focus=connect`)
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
