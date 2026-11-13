// THE DESKTOP APP'S MENU BAR (38.88), built as an `NSMenu` from what `menuBar.ts` answers.

import { FFIType } from 'bun:ffi'

import type { MenuRole, NativeMenuItem } from '#shared/menuItem.ts'

import {
    definedClass,
    type Id,
    nsString,
    objcClass,
    selector,
    send,
    sendTyped,
} from './appKit.ts'

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

type Choice = Exclude<NativeMenuItem, 'separator'>

// What each launcher-handled item fires, by the tag its `NSMenuItem` carries.
let chosen: Choice[] = []
let onChoice: (item: Choice) => void = () => {}
let target: Id = null

/**
 * Builds `menu` as the application's menu bar; `choose` is handed each item AppKit does not answer
 * itself when it is picked, in it and in `extra` — the menu bar extra's menu (38.170), built in the
 * same pass so both number their items from one list, and answered built.
 */
export function installMenu(
    menu: NativeMenuItem[],
    choose: (item: Choice) => void,
    extra: NativeMenuItem[] | undefined,
): Id {
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
    if (extra === undefined) return null
    const built = send(objcClass('NSMenu'), 'new')
    for (const item of extra) send(built, 'addItem:', menuItem(item))
    return built
}

function menuItem(item: NativeMenuItem): Id {
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
