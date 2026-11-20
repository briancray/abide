import { hotkeyBinding } from '#shared/hotkeyBinding.ts'

// NSEventModifierFlags.
const SHIFT = 1 << 17
const CONTROL = 1 << 18
const OPTION = 1 << 19
const COMMAND = 1 << 20

const NAMED_KEYS: Record<string, string> = {
    enter: '\r',
    return: '\r',
    tab: '\t',
    escape: '\x1b',
    backspace: '\b',
    delete: '\x7f',
    up: '',
    down: '',
    left: '',
    right: '',
}

/**
 * A `MenuItem`'s `key` as AppKit spells a shortcut: the key, and the mask of the modifiers written
 * before it. 53.9 — read by `hotkeyBinding`, as `hotkeys` and `keyLabel` read it, and a menu bar is
 * AppKit's alone, so `mod` is ⌘ here.
 */
export function menuShortcut(key: string | undefined): {
    keyEquivalent: string
    modifiers: number
} {
    if (key === undefined || key === '')
        return { keyEquivalent: '', modifiers: 0 }
    const binding = hotkeyBinding(key)
    const modifiers =
        (binding.shift === true ? SHIFT : 0) |
        (binding.ctrl ? CONTROL : 0) |
        (binding.alt ? OPTION : 0) |
        (binding.meta || binding.mod ? COMMAND : 0)
    const function_ = /^f([1-9]|1[0-2])$/.exec(binding.key)
    const keyEquivalent =
        NAMED_KEYS[binding.key] ??
        (function_ === null
            ? binding.key
            : String.fromCharCode(0xf704 + Number(function_[1]) - 1))
    return { keyEquivalent, modifiers }
}
