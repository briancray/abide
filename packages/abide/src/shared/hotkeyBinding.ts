// A binding as `hotkeys` and `keyLabel` both read it: its modifiers, then its key, joined by `+`.

// 53.9 — the spellings a native menu's `key` is written in too, read as the five they name, so one
// shortcut string labels, matches and fills the menu bar alike.
const MODIFIERS: Record<string, 'ctrl' | 'meta' | 'alt' | 'shift' | 'mod'> = {
    ctrl: 'ctrl',
    control: 'ctrl',
    meta: 'meta',
    cmd: 'meta',
    command: 'meta',
    alt: 'alt',
    option: 'alt',
    shift: 'shift',
    mod: 'mod',
}

// What a binding may name a key by besides `KeyboardEvent.key` itself.
const KEY_NAMES: Record<string, string> = { space: ' ', esc: 'escape' }

/** One binding, parsed once: the key it names and the modifiers it holds. */
export type HotkeyBinding = {
    key: string
    ctrl: boolean
    meta: boolean
    alt: boolean
    mod: boolean
    // `undefined` where the binding says nothing of shift and its key is a symbol, which shift types.
    shift: boolean | undefined
}

/** 53.9 — a binding as written, parsed; throws for a modifier that is not one of the five or a spelling of one. */
export function hotkeyBinding(written: string): HotkeyBinding {
    const tokens = written.split('+')
    // `'+'` and `'mod++'` name the plus key: the last split leaves an empty token behind it.
    let key = tokens.pop() ?? ''
    if (key === '' && tokens.at(-1) === '') {
        tokens.pop()
        key = '+'
    }
    key = key.toLowerCase()
    key = KEY_NAMES[key] ?? key
    const held = new Set<string>()
    for (const token of tokens) {
        const modifier = MODIFIERS[token.toLowerCase()]
        if (modifier === undefined)
            throw new TypeError(
                `abide: hotkey "${written}" holds "${token}", which is not one of ${Object.keys(MODIFIERS).join(', ')}. RULEBOOK 53.9.`,
            )
        held.add(modifier)
    }
    return {
        key,
        ctrl: held.has('ctrl'),
        meta: held.has('meta'),
        alt: held.has('alt'),
        mod: held.has('mod'),
        shift: held.has('shift') ? true : shiftTyped(key) ? undefined : false,
    }
}

// 53.5 — a symbol's key is what shift typed (`?` is shift and `/` on most layouts), so its binding
// matches either way. A letter, a digit and a named key (`escape`) read shift as a modifier.
function shiftTyped(key: string): boolean {
    return key.length === 1 && !/[a-z0-9 ]/.test(key)
}
