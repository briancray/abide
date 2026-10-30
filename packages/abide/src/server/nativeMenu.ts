// THE DESKTOP APP'S MENU BAR (38.88): the default, with the menus the standing layouts and page file
// with `onMenu`, built as an `NSMenu`.

import { FFIType } from 'bun:ffi'

import type { MenuRole } from '#shared/menuItem.ts'

import {
    definedClass,
    type Id,
    nsString,
    objcClass,
    selector,
    send,
    sendTyped,
} from './appKit.ts'

/**
 * A menu item as the window builds it: the defaults, and what a page told it (`reportMenu`), each
 * item the page answers numbered by `id`.
 */
export type NativeItem =
    | 'separator'
    | {
          label: string
          key?: string | undefined
          role?: MenuRole | undefined
          id?: number | undefined
          items?: NativeItem[] | undefined
      }

// 38.89 — A ROLE AppKit ALREADY ANSWERS is sent down the responder chain, so `copy` copies whatever
// holds the selection and is grayed where nothing does. The rest are the launcher's own.
const RESPONDER_ROLES: Partial<Record<MenuRole, string>> = {
    about: 'orderFrontStandardAboutPanel:',
    hide: 'hide:',
    hideOthers: 'hideOtherApplications:',
    showAll: 'unhideAllApplications:',
    quit: 'terminate:',
    close: 'performClose:',
    undo: 'undo:',
    redo: 'redo:',
    cut: 'cut:',
    copy: 'copy:',
    paste: 'paste:',
    selectAll: 'selectAll:',
    fullscreen: 'toggleFullScreen:',
    minimize: 'performMiniaturize:',
    zoom: 'performZoom:',
    front: 'arrangeInFront:',
}

const MODIFIERS: Record<string, number> = {
    shift: 1 << 17,
    ctrl: 1 << 18,
    control: 1 << 18,
    alt: 1 << 19,
    option: 1 << 19,
    cmd: 1 << 20,
    command: 1 << 20,
}

const NAMED_KEYS: Record<string, string> = {
    enter: '\r',
    return: '\r',
    tab: '\t',
    escape: '\x1b',
    esc: '\x1b',
    backspace: '\b',
    delete: '\x7f',
    space: ' ',
    up: '',
    down: '',
    left: '',
    right: '',
}

/**
 * The menu bar the window shows: the application, File, Edit, View and Window menus, and `added`.
 *
 * 38.88 — AN ADDED MENU NAMED AS A DEFAULT ONE GROWS IT, and any other stands before Window, where
 * the platform puts an app's own. 38.83 — no Connect… where what `onLauncher` answers turns connecting off.
 */
export function menuBar(
    appName: string,
    connect: boolean,
    added: NativeItem[],
): NativeItem[] {
    const bar = defaultMenu(appName, connect)
    const window = bar.pop() as NativeItem
    for (const menu of added) {
        const named =
            menu === 'separator'
                ? undefined
                : bar.find(
                      (standing) =>
                          standing !== 'separator' &&
                          standing.label === menu.label,
                  )
        if (
            named === undefined ||
            named === 'separator' ||
            menu === 'separator'
        )
            bar.push(menu)
        else named.items = [...(named.items ?? []), ...(menu.items ?? [])]
    }
    bar.push(window)
    return bar
}

function defaultMenu(appName: string, connect: boolean): NativeItem[] {
    return [
        {
            label: appName,
            items: [
                { label: `About ${appName}`, role: 'about' },
                'separator',
                { label: `Hide ${appName}`, role: 'hide', key: 'cmd+h' },
                { label: 'Hide Others', role: 'hideOthers', key: 'cmd+alt+h' },
                { label: 'Show All', role: 'showAll' },
                'separator',
                { label: `Quit ${appName}`, role: 'quit', key: 'cmd+q' },
            ],
        },
        {
            label: 'File',
            items: [
                ...(connect
                    ? ([
                          { label: 'Connect…', role: 'connect', key: 'cmd+k' },
                      ] as NativeItem[])
                    : []),
                { label: 'Disconnect', role: 'disconnect', key: 'cmd+shift+k' },
                'separator',
                { label: 'Close Window', role: 'close', key: 'cmd+w' },
            ],
        },
        {
            label: 'Edit',
            items: [
                { label: 'Undo', role: 'undo', key: 'cmd+z' },
                { label: 'Redo', role: 'redo', key: 'cmd+shift+z' },
                'separator',
                { label: 'Cut', role: 'cut', key: 'cmd+x' },
                { label: 'Copy', role: 'copy', key: 'cmd+c' },
                { label: 'Paste', role: 'paste', key: 'cmd+v' },
                { label: 'Select All', role: 'selectAll', key: 'cmd+a' },
            ],
        },
        {
            label: 'View',
            items: [
                { label: 'Reload', role: 'reload', key: 'cmd+r' },
                'separator',
                {
                    label: 'Enter Full Screen',
                    role: 'fullscreen',
                    key: 'ctrl+cmd+f',
                },
            ],
        },
        {
            label: 'Window',
            items: [
                { label: 'Minimize', role: 'minimize', key: 'cmd+m' },
                { label: 'Zoom', role: 'zoom' },
                'separator',
                { label: 'Bring All to Front', role: 'front' },
            ],
        },
    ]
}

type Choice = Exclude<NativeItem, 'separator'>

// What each launcher-handled item fires, by the tag its `NSMenuItem` carries.
let chosen: Choice[] = []
let onChoice: (item: Choice) => void = () => {}
let target: Id = null

/**
 * Builds `menu` as the application's menu bar; `choose` is handed each item AppKit does not answer
 * itself when it is picked.
 */
export function installMenu(
    menu: NativeItem[],
    choose: (item: Choice) => void,
): void {
    target ??= send(
        definedClass('AbideMenuTarget', {
            'choose:': {
                types: 'v@:@',
                args: [FFIType.ptr],
                returns: FFIType.void,
                run: (item: Id) => {
                    const picked =
                        chosen[
                            Number(
                                sendTyped(
                                    item,
                                    'tag',
                                    [],
                                    FFIType.i64,
                                ) as bigint,
                            )
                        ]
                    if (picked !== undefined) onChoice(picked)
                },
            },
        }),
        'new',
    )
    chosen = []
    onChoice = choose
    const bar = send(objcClass('NSMenu'), 'new')
    for (const item of menu) send(bar, 'addItem:', menuItem(item))
    send(
        send(objcClass('NSApplication'), 'sharedApplication'),
        'setMainMenu:',
        bar,
    )
}

function menuItem(item: NativeItem): Id {
    if (item === 'separator')
        return send(objcClass('NSMenuItem'), 'separatorItem')
    const { keyEquivalent, modifiers } = shortcut(item.key)
    const responder =
        item.role === undefined ? undefined : RESPONDER_ROLES[item.role]
    const built = send(
        send(objcClass('NSMenuItem'), 'alloc'),
        'initWithTitle:action:keyEquivalent:',
        nsString(item.label),
        null,
        nsString(keyEquivalent),
    )
    sendTyped(
        built,
        'setKeyEquivalentModifierMask:',
        [FFIType.u64],
        FFIType.void,
        modifiers,
    )
    if (item.items !== undefined) {
        const submenu = send(
            send(objcClass('NSMenu'), 'alloc'),
            'initWithTitle:',
            nsString(item.label),
        )
        for (const child of item.items)
            send(submenu, 'addItem:', menuItem(child))
        send(built, 'setSubmenu:', submenu)
        return built
    }
    if (responder !== undefined) {
        sendTyped(
            built,
            'setAction:',
            [FFIType.ptr],
            FFIType.void,
            selector(responder),
        )
        return built
    }
    sendTyped(
        built,
        'setAction:',
        [FFIType.ptr],
        FFIType.void,
        selector('choose:'),
    )
    send(built, 'setTarget:', target)
    sendTyped(built, 'setTag:', [FFIType.i64], FFIType.void, chosen.length)
    chosen.push(item)
    return built
}

/** A shortcut as AppKit spells it: the key, and the mask of the modifiers written before it. */
function shortcut(key: string | undefined): {
    keyEquivalent: string
    modifiers: number
} {
    if (key === undefined || key === '')
        return { keyEquivalent: '', modifiers: 0 }
    const parts = key.toLowerCase().split('+')
    const last = parts.pop() as string
    let modifiers = 0
    for (const part of parts) modifiers |= MODIFIERS[part] ?? 0
    const named = NAMED_KEYS[last]
    const function_ = /^f([1-9]|1[0-2])$/.exec(last)
    const keyEquivalent =
        named ??
        (function_ === null
            ? last
            : String.fromCharCode(0xf704 + Number(function_[1]) - 1))
    return { keyEquivalent, modifiers }
}
