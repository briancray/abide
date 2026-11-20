// 53.11 — A BINDING AS A PERSON READS IT, decided by `isApplePlatform` as `hotkeys` matches it, or by
// the caller's `apple` where it names one.

import { hotkeyBinding } from './hotkeyBinding.ts'
import { isApplePlatform } from './isApplePlatform.ts'

const NAMED: Record<string, string> = {
    ' ': 'Space',
    escape: 'Esc',
    enter: 'Enter',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
}

// 53.54 — the keys an Apple platform writes as a symbol, over `NAMED`.
const APPLE_NAMED: Record<string, string> = {
    enter: '↩',
    escape: '⎋',
    backspace: '⌫',
    delete: '⌦',
    tab: '⇥',
}

/** What `keyLabel` and `keyLabel.parts` take beside the binding. */
type LabelOptions = {
    /** 53.56 — whether to write the keys as an Apple platform does. The platform 53.3 reads by default. */
    apple?: boolean
}

/**
 * A `hotkeys` binding written for a person to read: `'mod+k'` is `⌘K` on an Apple platform and
 * `Ctrl+K` on any other, and a server render writes what the page it answers hydrates.
 *
 * @param binding a binding as `hotkeys` takes it
 * @param options which platform's way to write it, where not the visitor's
 */
export function keyLabel(binding: string, options: LabelOptions = {}): string {
    const apple = options.apple ?? isApplePlatform()
    return parts(binding, apple).join(apple ? '' : '+')
}

/**
 * 53.55 — each key `keyLabel` writes, apart and in its order: `'mod+shift+k'` is `['⌘', '⇧', 'K']`
 * on an Apple platform — one cap per key for a key hint.
 */
keyLabel.parts = (binding: string, options: LabelOptions = {}): string[] =>
    parts(binding, options.apple ?? isApplePlatform())

function parts(binding: string, apple: boolean): string[] {
    const { key, ctrl, meta, alt, mod, shift } = hotkeyBinding(binding)
    const named =
        (apple ? APPLE_NAMED[key] : undefined) ??
        NAMED[key] ??
        (key.length === 1 ? key.toUpperCase() : capital(key))
    const held: string[] = []
    if (apple) {
        if (ctrl) held.push('⌃')
        if (alt) held.push('⌥')
        if (shift) held.push('⇧')
        if (meta || mod) held.push('⌘')
    } else {
        if (ctrl || mod) held.push('Ctrl')
        if (meta) held.push('Meta')
        if (alt) held.push('Alt')
        if (shift) held.push('Shift')
    }
    held.push(named)
    return held
}

function capital(key: string): string {
    return key.charAt(0).toUpperCase() + key.slice(1)
}
