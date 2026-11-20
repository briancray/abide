// 38.166-38.171 — THE MENU BAR EXTRA: an item in the platform's menu bar whose primary click opens
// the app's `native/menubar.abide` in a panel under it, or shows and hides the window where there is
// no such page or no app, and whose secondary click opens the page's menus and Quit.

import { FFIType } from 'bun:ffi'

import { MENU_BAR_ADDRESS } from '#shared/ADDRESSES.ts'

import {
    created,
    definedClass,
    flagOf,
    type Id,
    nsString,
    objcClass,
    rectOf,
    selector,
    send,
    sendFlag,
    sendNumber,
    sendPair,
    sendTyped,
    windowButton,
} from './appKit.ts'
import type { Launcher } from './launcherOptions.ts'
import { nativeUserAgent } from './nativeUserAgent.ts'
import { WINDOW_STYLE } from './WINDOW_STYLE.ts'

/** The picture the item is drawn from, and whether the platform tints it as a template. */
export type MenuBarIcon = { bytes: Uint8Array; template: boolean }

// NSVariableStatusItemLength.
const VARIABLE_LENGTH = -1
const ICON_POINTS = 18
const STATUS_WINDOW_LEVEL = 25
// NSWindowCollectionBehavior: move to the active space, transient, and over a full-screen app.
const PANEL_BEHAVIOR = (1 << 1) | (1 << 3) | (1 << 8)
// NSEventMaskLeftMouseUp | NSEventMaskRightMouseUp.
const CLICKS = (1 << 2) | (1 << 4)
const RIGHT_MOUSE_UP = 4
const CONTROL_KEY = 1 << 18
const SCREEN_MARGIN = 8
// A press on the item takes the key from an open panel before the item hears it; a click this soon
// after the panel closed that way is the click that closed it, and opens nothing.
const RESIGNED_MILLISECONDS = 300

/**
 * Puts the item in the menu bar and answers what the window drives it with: the menu its secondary
 * click opens, and the panel to close where the window navigates away from the app it shows.
 *
 * `shown` is the address of the app the window shows, `undefined` while it shows the launcher,
 * `hasPage` whether the app at an address answers it, and `front` brings the window forward.
 */
export function openMenuBarExtra(
    appName: string,
    version: string,
    icon: MenuBarIcon | undefined,
    options: Launcher,
    window: Id,
    uiDelegate: Id,
    shown: () => string | undefined,
    hasPage: (address: string) => Promise<boolean>,
    connectPage: (view: Id) => void,
    front: () => void,
): { setMenu(menu: Id): void; closePanel(): void } {
    const application = send(objcClass('NSApplication'), 'sharedApplication')
    const item = sendTyped(
        send(objcClass('NSStatusBar'), 'systemStatusBar'),
        'statusItemWithLength:',
        [FFIType.f64],
        FFIType.ptr,
        VARIABLE_LENGTH,
    ) as Id
    send(item, 'retain')
    const button = send(item, 'button')
    if (icon === undefined) send(button, 'setTitle:', nsString(appName))
    else {
        const image = send(
            send(objcClass('NSImage'), 'alloc'),
            'initWithData:',
            sendTyped(
                objcClass('NSData'),
                'dataWithBytes:length:',
                [FFIType.ptr, FFIType.u64],
                FFIType.ptr,
                icon.bytes,
                icon.bytes.length,
            ) as Id,
        )
        sendPair(image, 'setSize:', ICON_POINTS, ICON_POINTS)
        sendFlag(image, 'setTemplate:', icon.template)
        send(button, 'setImage:', image)
    }

    let menu: Id = null
    let panel: Panel | undefined
    let resignedAt = 0
    // Whether the app at an address answers `MENU_BAR_ADDRESS`, asked once per address.
    const answers = new Map<string, Promise<boolean>>()

    // 38.169 — CLOSED rather than ordered out, as its close button closes it (38.172), so the window's
    // delegate hears every way it goes (38.183).
    const toggleWindow = (): void => {
        if (
            flagOf(window, 'isVisible') &&
            flagOf(window, 'isKeyWindow') &&
            flagOf(application, 'isActive')
        )
            send(window, 'close')
        else front()
    }
    // 38.168.
    const togglePanel = (address: string): void => {
        if (panel !== undefined && flagOf(panel.window, 'isVisible')) {
            send(panel.window, 'orderOut:', null)
            return
        }
        if (Date.now() - resignedAt < RESIGNED_MILLISECONDS) return
        panel ??= openPanel(
            options,
            nativeUserAgent(version, appName),
            uiDelegate,
            connectPage,
            () => {
                resignedAt = Date.now()
            },
        )
        if (panel.address !== address) {
            panel.address = address
            send(
                panel.view,
                'loadRequest:',
                send(
                    objcClass('NSURLRequest'),
                    'requestWithURL:',
                    send(
                        objcClass('NSURL'),
                        'URLWithString:',
                        nsString(address),
                    ),
                ),
            )
        }
        placeUnder(panel.window, button, options.panelWidth)
        sendFlag(application, 'activateIgnoringOtherApps:', true)
        send(panel.window, 'makeKeyAndOrderFront:', null)
    }
    const primary = async (): Promise<void> => {
        const app = shown()
        if (app === undefined) return toggleWindow()
        const address = `${app}${MENU_BAR_ADDRESS.slice(1)}`
        let asked = answers.get(address)
        if (asked === undefined) {
            asked = hasPage(address)
            answers.set(address, asked)
        }
        if (await asked) togglePanel(address)
        else toggleWindow()
    }

    send(
        button,
        'setTarget:',
        send(
            definedClass('AbideMenuBarExtra', {
                'clicked:': {
                    types: 'v@:@',
                    args: [FFIType.ptr],
                    returns: FFIType.void,
                    run: () => {
                        const event = send(application, 'currentEvent')
                        const secondary =
                            event !== null &&
                            (Number(
                                sendTyped(event, 'type', [], FFIType.u64),
                            ) === RIGHT_MOUSE_UP ||
                                (Number(
                                    sendTyped(
                                        event,
                                        'modifierFlags',
                                        [],
                                        FFIType.u64,
                                    ),
                                ) &
                                    CONTROL_KEY) !==
                                    0)
                        // 38.170 — the item opens the menu while it holds one, and holds it no longer.
                        if (secondary) {
                            send(item, 'setMenu:', menu)
                            send(button, 'performClick:', null)
                            send(item, 'setMenu:', null)
                            return
                        }
                        primary().catch(() => toggleWindow())
                    },
                },
            }),
            'new',
        ),
    )
    send(button, 'setAction:', selector('clicked:'))
    sendTyped(button, 'sendActionOn:', [FFIType.u64], FFIType.i64, CLICKS)
    return {
        setMenu: (built) => {
            menu = built
        },
        closePanel: () => {
            if (panel !== undefined) send(panel.window, 'orderOut:', null)
        },
    }
}

type Panel = { window: Id; view: Id; address: string }

/** The panel, built hidden: no controls, no titlebar of its own, and closed when it loses the key. */
function openPanel(
    options: Launcher,
    userAgent: string,
    uiDelegate: Id,
    connectPage: (view: Id) => void,
    resigned: () => void,
): Panel {
    const window = created('NSPanel')
    sendNumber(
        window,
        'setStyleMask:',
        WINDOW_STYLE.TITLED | WINDOW_STYLE.FULL_SIZE_CONTENT_VIEW,
        FFIType.u64,
    )
    sendFlag(window, 'setTitlebarAppearsTransparent:', true)
    sendNumber(window, 'setTitleVisibility:', 1)
    for (let button = 0; button < 3; button += 1)
        sendFlag(windowButton(window, button), 'setHidden:', true)
    sendFlag(window, 'setMovable:', false)
    sendFlag(window, 'setReleasedWhenClosed:', false)
    sendNumber(window, 'setLevel:', STATUS_WINDOW_LEVEL)
    sendNumber(window, 'setCollectionBehavior:', PANEL_BEHAVIOR, FFIType.u64)
    sendPair(window, 'setContentSize:', options.panelWidth, options.panelHeight)
    // 38.163 — NEVER OPEN TO WEB INSPECTOR, whatever `inspector` answers: the inspector is a window
    // of its own that takes the key, and the panel closes as it loses it (38.171), so the two trade
    // the key in a loop. Its page is inspected in the window, at the address the panel loads.
    const view = created('WKWebView')
    send(view, 'setUIDelegate:', uiDelegate)
    send(view, 'setNavigationDelegate:', uiDelegate)
    // 38.140 — the panel's page is the native app's as much as the window's is.
    send(view, 'setCustomUserAgent:', nsString(userAgent))
    // 38.148, 38.188 — before it loads, so its `pendingUpdate` and its badge reach a channel that is there.
    connectPage(view)
    send(window, 'setContentView:', view)
    // 38.171.
    send(
        window,
        'setDelegate:',
        send(
            definedClass('AbidePanelDelegate', {
                'windowDidResignKey:': {
                    types: 'v@:@',
                    args: [FFIType.ptr],
                    returns: FFIType.void,
                    run: () => {
                        // 38.171 — the key a page's `alert` takes from it as a sheet (38.178).
                        if (send(window, 'attachedSheet') !== null) return
                        resigned()
                        send(window, 'orderOut:', null)
                    },
                },
            }),
            'new',
        ),
    )
    return { window, view, address: '' }
}

/** Moves `window` to hang under `button`, centered on it, and inside the screen it is on. */
function placeUnder(window: Id, button: Id, width: number): void {
    const host = send(button, 'window')
    const [x, y, buttonWidth] = rectOf(host, 'frame')
    const [screenX, , screenWidth] = rectOf(
        send(host, 'screen'),
        'visibleFrame',
    )
    const height = rectOf(window, 'frame')[3]
    const left = Math.min(
        Math.max(x + buttonWidth / 2 - width / 2, screenX + SCREEN_MARGIN),
        screenX + screenWidth - width - SCREEN_MARGIN,
    )
    sendPair(window, 'setFrameOrigin:', left, y - height)
}
