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

// 53.6 — the `KeyboardEvent.code` of a printing key other than a letter or a digit, to what it
// types on a US layout. No `KeyboardEvent.key` is spelled as any of these, nor as `Key` and a
// letter, `Digit` or `Numpad` and a digit.
const CODE_KEYS: Record<string, string> = {
    minus: '-',
    equal: '=',
    bracketleft: '[',
    bracketright: ']',
    backslash: '\\',
    intlbackslash: '\\',
    semicolon: ';',
    quote: "'",
    backquote: '`',
    comma: ',',
    period: '.',
    slash: '/',
}

/** One binding, parsed once: the key it names and the modifiers it holds. */
export type HotkeyBinding = {
    /** What the key types, on a US layout where the binding names it by `code`. */
    key: string
    /** 53.6 — the `KeyboardEvent.code` the binding names, lowercased, or `undefined` where it names a `key`. */
    code: string | undefined
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
    const code = codeKey(key)
    const named = key
    if (code !== undefined) key = code
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
        code: code === undefined ? undefined : named,
        ctrl: held.has('ctrl'),
        meta: held.has('meta'),
        alt: held.has('alt'),
        mod: held.has('mod'),
        shift: held.has('shift')
            ? true
            : code === undefined && shiftTyped(key)
              ? undefined
              : false,
    }
}

// 53.6 — what a key named by its `KeyboardEvent.code` types on a US layout, or `undefined` where
// the name is no such code.
function codeKey(name: string): string | undefined {
    if (/^key[a-z]$/.test(name)) return name.charAt(3)
    if (/^(digit|numpad)[0-9]$/.test(name)) return name.charAt(name.length - 1)
    return CODE_KEYS[name]
}

// 53.5 — a symbol's key is what shift typed (`?` is shift and `/` on most layouts), so its binding
// matches either way. A letter, a digit and a named key (`escape`) read shift as a modifier.
function shiftTyped(key: string): boolean {
    return key.length === 1 && !/[a-z0-9 ]/.test(key)
}
