// 50.30, 51.4-51.6, 51.36, 51.37 — THE ITEM A KEY MOVES TO in a list the keyboard roves: the next and
// the previous on the arrows along the list's orientation, going round the ends where it wraps, and
// the first and the last on Home and End. What `listbox`, `menu` and `tabs` share; each does its own
// thing with the index — an active option, focus, a selection.
//
// THE LIST IS LOCATED ONLY FOR A KEY THAT MOVES: a key that does not — Escape, Enter, a letter — is
// answered before `locate` runs, so a list that is a live search is not read for a keystroke that
// leaves it alone.

/**
 * Which way `key` steps along a list of that orientation: `1` forward, `-1` back, `0` neither. A list
 * running `'both'` ways steps on either pair of arrows, as a radio group does (51.113).
 */
export function stepOf(
    key: string,
    orientation: 'vertical' | 'horizontal' | 'both',
): number {
    const vertical = orientation !== 'horizontal'
    const horizontal = orientation !== 'vertical'
    if (
        (vertical && key === 'ArrowDown') ||
        (horizontal && key === 'ArrowRight')
    )
        return 1
    if ((vertical && key === 'ArrowUp') || (horizontal && key === 'ArrowLeft'))
        return -1
    return 0
}

/**
 * 50.28, 51.14 — the end of a SHUT list `key` opens it at: its first item on the forward arrow, its
 * last on the back arrow, and `undefined` for a key that opens nothing. What a `menu`'s trigger and a
 * `Combobox`'s input share, from the same arrows `roving` steps by.
 */
export function openingEnd(
    key: string,
    orientation: 'vertical' | 'horizontal',
): 'first' | 'last' | undefined {
    const step = stepOf(key, orientation)
    return step === 1 ? 'first' : step === -1 ? 'last' : undefined
}

/**
 * The index `key` moves to, or `-1` where it moves nowhere. `locate` answers where the list is: the
 * index of the item on now, `-1` for none, and how many there are. From none, the forward arrow
 * moves to the first and the back arrow to the last.
 */
export function roving(
    key: string,
    orientation: 'vertical' | 'horizontal' | 'both',
    locate: () => readonly [at: number, length: number],
    wrap = true,
): number {
    const step = stepOf(key, orientation)
    const forward = step === 1
    const back = step === -1
    if (step === 0 && key !== 'Home' && key !== 'End') return -1
    const [at, length] = locate()
    if (length === 0) return -1
    const last = length - 1
    if (forward) return at === -1 ? 0 : at === last ? (wrap ? 0 : last) : at + 1
    if (back) return at === -1 ? last : at === 0 ? (wrap ? last : 0) : at - 1
    return key === 'Home' ? 0 : last
}

// 50.40 — how long typed letters keep adding to the text an item is looked for by.
const TYPED_FOR = 500

/**
 * 50.40, 51.82 — A LIST'S TYPE-AHEAD: the index a printable key moves to, the next item whose text
 * starts with what was typed, or `-1`. A letter typed again walks the items starting with it; letters
 * typed within half a second of each other are one word, found from the item on now. What `menu` and
 * `tree` share; each holds its own, since what was typed belongs to the one list it was typed in.
 */
export function typeahead(): (
    event: KeyboardEvent,
    at: number,
    length: number,
    textOf: (index: number) => string,
) => number {
    let typed = ''
    let typedAt = 0
    return (event, at, length, textOf) => {
        if (
            event.key.length !== 1 ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
        )
            return -1
        const now = event.timeStamp
        typed =
            now - typedAt > TYPED_FOR
                ? event.key.toLowerCase()
                : typed + event.key.toLowerCase()
        typedAt = now
        const from = typed.length === 1 ? at + 1 : Math.max(at, 0)
        for (let step = 0; step < length; step += 1) {
            const index = (from + step) % length
            if (textOf(index).toLowerCase().startsWith(typed)) return index
        }
        return -1
    }
}
