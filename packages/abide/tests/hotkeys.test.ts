// 53.1-53.11 — WHICH KEY PRESS A BINDING TAKES, decided without mounting anything: a binding is a
// listener, and a press is an event dispatched at a target.

import { afterEach, expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import { hotkeyBinding } from '#shared/hotkeyBinding.ts'
import { hotkeys } from '#shared/hotkeys.ts'
import { isEditableTarget } from '#shared/isEditableTarget.ts'
import { keyLabel } from '#shared/keyLabel.ts'

afterEach(() => {
    Reflect.deleteProperty(navigator, 'userAgent')
    document.body.replaceChildren()
})

function onPlatform(agent: string) {
    Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => agent,
    })
}

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

/** Which bindings a press ran, and whether it was taken. */
function pressed(
    bindings: string[],
    init: KeyboardEventInit,
    target: EventTarget = document.body,
): { ran: string[]; taken: boolean } {
    const ran: string[] = []
    const table: Record<string, () => void> = {}
    for (const binding of bindings) table[binding] = () => ran.push(binding)
    const listener = hotkeys(table)
    const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init,
    })
    target.addEventListener('keydown', listener as EventListener, {
        once: true,
    })
    target.dispatchEvent(event)
    return { ran, taken: event.defaultPrevented }
}

test('mod is ⌘ on an Apple platform and Ctrl on any other — 53.3', () => {
    onPlatform(MAC)
    expect(pressed(['mod+k'], { key: 'k', metaKey: true }).ran).toEqual([
        'mod+k',
    ])
    expect(pressed(['mod+k'], { key: 'k', ctrlKey: true }).ran).toEqual([])
    onPlatform(WINDOWS)
    expect(pressed(['mod+k'], { key: 'k', ctrlKey: true }).ran).toEqual([
        'mod+k',
    ])
    expect(pressed(['mod+k'], { key: 'k', metaKey: true }).ran).toEqual([])
})

test('the first binding a press matches runs alone, and only it is prevented — 53.1, 53.2', () => {
    expect(pressed(['k', 'K'], { key: 'k' })).toEqual({
        ran: ['k'],
        taken: true,
    })
    expect(pressed(['k'], { key: 'j' })).toEqual({ ran: [], taken: false })
})

// THE REVERT: call `preventDefault` whatever `prevent` says — `taken: true` where the dialog under
// the panel is owed its Escape, `false`.
test('a binding whose prevent is false runs and leaves the key its default — 53.2', () => {
    let ran = 0
    const listener = hotkeys({
        Escape: {
            run: () => {
                ran += 1
            },
            prevent: false,
        },
    })
    const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
    })
    listener(event)
    expect({ ran, taken: event.defaultPrevented }).toEqual({
        ran: 1,
        taken: false,
    })
})

test('a modifier the binding does not hold refuses the press — 53.4', () => {
    expect(pressed(['k'], { key: 'k', ctrlKey: true }).ran).toEqual([])
    expect(pressed(['k'], { key: 'K', shiftKey: true }).ran).toEqual([])
    expect(pressed(['shift+k'], { key: 'K', shiftKey: true }).ran).toEqual([
        'shift+k',
    ])
})

// THE REVERT: read shift as a modifier for every key, and `?` (shift and `/`) never matches.
test('a symbol is matched by what it types, shift or not — 53.5', () => {
    expect(pressed(['?'], { key: '?', shiftKey: true }).ran).toEqual(['?'])
    expect(pressed(['shift+?'], { key: '?', shiftKey: true }).ran).toEqual([
        'shift+?',
    ])
})

test('a named key is case-blind, and space and plus are keys — 53.6', () => {
    expect(pressed(['escape'], { key: 'Escape' }).ran).toEqual(['escape'])
    expect(pressed(['space'], { key: ' ' }).ran).toEqual(['space'])
    expect(pressed(['mod++'], { key: '+', ctrlKey: true }).ran).toEqual([
        'mod++',
    ])
})

test('a letter alt composed into another character is matched by where it sits — 53.6', () => {
    expect(
        pressed(['alt+k'], { key: '˚', code: 'KeyK', altKey: true }).ran,
    ).toEqual(['alt+k'])
    expect(pressed(['k'], { key: 'j', code: 'KeyK' }).ran).toEqual([])
})

test('a binding naming no modifier abide knows is refused as it is written — 53.9', () => {
    expect(() => hotkeys({ 'Hyper+k': () => {} })).toThrow(/"Hyper"/)
})

// THE REVERT: drop the spellings, and the menu bar's `cmd+shift+r` throws where it is labelled.
test("a native menu's spellings read as the modifiers they name — 53.9", () => {
    expect(hotkeyBinding('cmd+shift+r')).toEqual(hotkeyBinding('meta+shift+r'))
    expect(hotkeyBinding('Command+Option+Control+k')).toEqual(
        hotkeyBinding('meta+alt+ctrl+k'),
    )
})

// THE REVERT: drop the `defaultPrevented` check, and Escape closes the page's panel as well as the
// menu inside it that already took it; drop the `isComposing` check, and the Enter that picks a word
// in an input method runs the page's Enter.
test('a press an inner handler took, or one an input method is composing, is not a shortcut — 53.8', () => {
    const taken = new KeyboardEvent('keydown', {
        key: 'Escape',
        cancelable: true,
    })
    taken.preventDefault()
    const ran: string[] = []
    hotkeys({ Escape: () => ran.push('Escape') })(taken)
    expect(ran).toEqual([])
    expect(pressed(['n'], { key: 'n', isComposing: true }).ran).toEqual([])
    expect(pressed(['n'], { key: 'n', keyCode: 229 }).ran).toEqual([])
})

// THE REVERT: drop the `editing` check in `hotkeys`, and a bare n typed into a field runs the page's n.
test('a field is the visitor’s: a bare key stands aside there unless it says editable — 53.7, 53.10', () => {
    const field = document.createElement('input')
    const box = document.createElement('input')
    box.type = 'checkbox'
    const written = document.createElement('div')
    written.contentEditable = 'true'
    document.body.append(field, box, written)
    expect(isEditableTarget(field)).toBe(true)
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true)
    expect(isEditableTarget(document.createElement('select'))).toBe(true)
    expect(isEditableTarget(box)).toBe(false)
    expect(isEditableTarget(document.createElement('button'))).toBe(false)
    expect(isEditableTarget(written)).toBe(true)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(window)).toBe(false)
    expect(pressed(['n'], { key: 'n' }, field)).toEqual({
        ran: [],
        taken: false,
    })
    expect(pressed(['n'], { key: 'n' }, box).ran).toEqual(['n'])
    const ran: string[] = []
    const listener = hotkeys({
        n: { run: () => ran.push('n'), editable: true },
    })
    field.addEventListener('keydown', listener as EventListener)
    field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', bubbles: true }),
    )
    expect(ran).toEqual(['n'])
})

test('a label writes a binding as the platform reads it — 53.11', () => {
    onPlatform(MAC)
    expect(keyLabel('mod+k')).toBe('⌘K')
    expect(keyLabel('shift+alt+ArrowUp')).toBe('⌥⇧↑')
    onPlatform(WINDOWS)
    expect(keyLabel('mod+k')).toBe('Ctrl+K')
    expect(keyLabel('shift+?')).toBe('Shift+?')
    expect(keyLabel('Escape')).toBe('Esc')
})

// THE REVERT: write `NAMED` alone on an Apple platform — `⌘Enter` where `⌘↩` is due.
test('an Apple platform writes the named keys it has a symbol for as that symbol — 53.54', () => {
    onPlatform(MAC)
    expect(keyLabel('mod+Enter')).toBe('⌘↩')
    expect(keyLabel('Escape')).toBe('⎋')
    expect(keyLabel('alt+Backspace')).toBe('⌥⌫')
    onPlatform(WINDOWS)
    expect(keyLabel('mod+Enter')).toBe('Ctrl+Enter')
})

// THE REVERT: read `isApplePlatform()` over `apple` — the Windows visitor's label asked for as a
// Mac's reads `Ctrl+Shift+K`, where `⇧⌘K` is due.
test('parts are the keys a label writes, apart, and apple names the platform — 53.55, 53.56', () => {
    onPlatform(WINDOWS)
    expect(keyLabel.parts('mod+shift+k')).toEqual(['Ctrl', 'Shift', 'K'])
    expect(keyLabel('mod+shift+k', { apple: true })).toBe('⇧⌘K')
    expect(keyLabel.parts('mod+shift+k', { apple: true })).toEqual([
        '⇧',
        '⌘',
        'K',
    ])
    onPlatform(MAC)
    expect(keyLabel('mod+k', { apple: false })).toBe('Ctrl+K')
})

// 53.3 — A SERVER ANSWERING NO REQUEST reads its own platform. Run with no DOM, where every module
// is a server's. THE REVERT: test the empty agent against the Apple pattern again — on a Mac
// `Ctrl+K` where `⌘K` is due.
test('outside a request, a server labels mod by its own platform — 53.3', async () => {
    const ran = await spawned([
        'bun',
        '-e',
        `import { keyLabel } from '${new URL('../src/shared/keyLabel.ts', import.meta.url).pathname}'
console.log(keyLabel('mod+k'))`,
    ])
    expect(ran.stdout.trim()).toBe(
        process.platform === 'darwin' ? '⌘K' : 'Ctrl+K',
    )
})
