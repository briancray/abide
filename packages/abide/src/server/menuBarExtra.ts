// 38.166-38.171 — THE MENU BAR EXTRA: an item in the platform's menu bar whose primary click opens
// the app's `native/menubar.abide` in a panel under it, or shows and hides the window where there is
// no such page or no app, and whose secondary click opens the page's menus and Quit.

import { FFIType } from 'bun:ffi'

import { MENU_BAR_ADDRESS } from '#shared/ADDRESSES.ts'

import {
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
} from './appKit.ts'
import { desktopUserAgent } from './desktopUserAgent.ts'
import type { Launcher } from './launcherOptions.ts'

/** The picture the item is drawn from, and whether the platform tints it as a template. */
export type MenuBarIcon = { bytes: Uint8Array; template: boolean }

// NSVariableStatusItemLength.
const VARIABLE_LENGTH = -1
const ICON_POINTS = 18
const TITLED = 1
const FULL_SIZE_CONTENT_VIEW = 1 << 15
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
 * `shown` is the address of the app the window shows, `undefined` while it shows the launcher.
 */
export function openMenuBarExtra(
    appName: string,
    version: string,
    icon: MenuBarIcon | undefined,
    options: Launcher,
    window: Id,
    uiDelegate: Id,
    shown: () => string | undefined,
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
        sendTyped(
            image,
            'setSize:',
            [FFIType.f64, FFIType.f64],
            FFIType.void,
            ICON_POINTS,
            ICON_POINTS,
        )
        sendTyped(
            image,
            'setTemplate:',
            [FFIType.bool],
            FFIType.void,
            icon.template,
        )
        send(button, 'setImage:', image)
    }

    let menu: Id = null
    let panel: Panel | undefined
    let resignedAt = 0
    // Whether the app at an address answers `MENU_BAR_ADDRESS`, asked once per address.
    const hasPage = new Map<string, Promise<boolean>>()

    const showWindow = (): void => {
        sendTyped(
            application,
            'activateIgnoringOtherApps:',
            [FFIType.bool],
            FFIType.void,
            true,
        )
        send(window, 'makeKeyAndOrderFront:', null)
    }
    // 38.169.
    const toggleWindow = (): void => {
        if (
            isTrue(window, 'isVisible') &&
            isTrue(window, 'isKeyWindow') &&
            isTrue(application, 'isActive')
        )
            send(window, 'orderOut:', null)
        else showWindow()
    }
    // 38.168.
    const togglePanel = (address: string): void => {
        if (panel !== undefined && isTrue(panel.window, 'isVisible')) {
            send(panel.window, 'orderOut:', null)
            return
        }
        if (Date.now() - resignedAt < RESIGNED_MILLISECONDS) return
        panel ??= openPanel(options, version, uiDelegate, () => {
            resignedAt = Date.now()
        })
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
        sendTyped(
            application,
            'activateIgnoringOtherApps:',
            [FFIType.bool],
            FFIType.void,
            true,
        )
        send(panel.window, 'makeKeyAndOrderFront:', null)
    }
    const primary = async (): Promise<void> => {
        const app = shown()
        if (app === undefined) return toggleWindow()
        const address = `${app}${MENU_BAR_ADDRESS.slice(1)}`
        let asked = hasPage.get(address)
        if (asked === undefined) {
            asked = fetch(address, { method: 'HEAD' }).then(
                (answer) => answer.ok,
                () => false,
            )
            hasPage.set(address, asked)
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
    sendTyped(
        button,
        'setAction:',
        [FFIType.ptr],
        FFIType.void,
        selector('clicked:'),
    )
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
    version: string,
    uiDelegate: Id,
    resigned: () => void,
): Panel {
    const window = created('NSPanel')
    sendTyped(
        window,
        'setStyleMask:',
        [FFIType.u64],
        FFIType.void,
        TITLED | FULL_SIZE_CONTENT_VIEW,
    )
    sendTyped(
        window,
        'setTitlebarAppearsTransparent:',
        [FFIType.bool],
        FFIType.void,
        true,
    )
    sendTyped(window, 'setTitleVisibility:', [FFIType.i64], FFIType.void, 1)
    for (let button = 0; button < 3; button += 1)
        sendTyped(
            sendTyped(
                window,
                'standardWindowButton:',
                [FFIType.u64],
                FFIType.ptr,
                button,
            ) as Id,
            'setHidden:',
            [FFIType.bool],
            FFIType.void,
            true,
        )
    sendTyped(window, 'setMovable:', [FFIType.bool], FFIType.void, false)
    sendTyped(
        window,
        'setReleasedWhenClosed:',
        [FFIType.bool],
        FFIType.void,
        false,
    )
    sendTyped(
        window,
        'setLevel:',
        [FFIType.i64],
        FFIType.void,
        STATUS_WINDOW_LEVEL,
    )
    sendTyped(
        window,
        'setCollectionBehavior:',
        [FFIType.u64],
        FFIType.void,
        PANEL_BEHAVIOR,
    )
    sendTyped(
        window,
        'setContentSize:',
        [FFIType.f64, FFIType.f64],
        FFIType.void,
        options.panelWidth,
        options.panelHeight,
    )
    const view = created('WKWebView')
    // 38.163.
    if (options.inspector)
        send(
            send(send(view, 'configuration'), 'preferences'),
            'setValue:forKey:',
            nsBoolean(true),
            nsString('developerExtrasEnabled'),
        )
    send(view, 'setUIDelegate:', uiDelegate)
    // 38.140 — the panel's page is the desktop app's as much as the window's is.
    send(view, 'setCustomUserAgent:', nsString(desktopUserAgent(version)))
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
    sendTyped(
        window,
        'setFrameOrigin:',
        [FFIType.f64, FFIType.f64],
        FFIType.void,
        left,
        y - height,
    )
}

function isTrue(receiver: Id, name: string): boolean {
    return sendTyped(receiver, name, [], FFIType.bool) as boolean
}
