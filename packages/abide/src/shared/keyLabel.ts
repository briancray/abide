// 53.11 — A BINDING AS A PERSON READS IT, decided by `isApplePlatform` as `hotkeys` matches it.

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

/**
 * A `hotkeys` binding written for a person to read: `'mod+k'` is `⌘K` on an Apple platform and
 * `Ctrl+K` on any other, and a server render writes what the page it answers hydrates.
 *
 * @param binding a binding as `hotkeys` takes it
 */
export function keyLabel(binding: string): string {
    const { key, ctrl, meta, alt, mod, shift } = hotkeyBinding(binding)
    const apple = isApplePlatform()
    const named =
        NAMED[key] ?? (key.length === 1 ? key.toUpperCase() : capital(key))
    if (apple) {
        let label = ''
        if (ctrl) label += '⌃'
        if (alt) label += '⌥'
        if (shift) label += '⇧'
        if (meta || mod) label += '⌘'
        return label + named
    }
    const held: string[] = []
    if (ctrl || mod) held.push('Ctrl')
    if (meta) held.push('Meta')
    if (alt) held.push('Alt')
    if (shift) held.push('Shift')
    held.push(named)
    return held.join('+')
}

function capital(key: string): string {
    return key.charAt(0).toUpperCase() + key.slice(1)
}
