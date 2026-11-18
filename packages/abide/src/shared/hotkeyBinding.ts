// A binding as `hotkeys` and `keyLabel` both read it: its modifiers, then its key, joined by `+`.

const MODIFIERS = new Set(['ctrl', 'meta', 'alt', 'shift', 'mod'])

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

/** 53.9 — a binding as written, parsed; throws for a modifier that is not one of the five. */
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
    for (const token of tokens) held.add(token.toLowerCase())
    for (const modifier of held)
        if (!MODIFIERS.has(modifier))
            throw new TypeError(
                `abide: hotkey "${written}" holds "${modifier}", which is not one of ${[...MODIFIERS].join(', ')}. RULEBOOK 53.9.`,
            )
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
