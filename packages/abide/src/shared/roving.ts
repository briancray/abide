// 50.30, 51.4-51.6, 51.38, 51.39 — THE ITEM A KEY MOVES TO in a list the keyboard roves: the next and
// the previous on the arrows along the list's orientation, going round the ends where it wraps, and
// the first and the last on Home and End. What `listbox`, `menu` and `tabs` share; each does its own
// thing with the index — an active option, focus, a selection.
//
// THE LIST IS LOCATED ONLY FOR A KEY THAT MOVES: a key that does not — Escape, Enter, a letter — is
// answered before `locate` runs, so a list that is a live search is not read for a keystroke that
// leaves it alone.

/**
 * The index `key` moves to, or `-1` where it moves nowhere. `locate` answers where the list is: the
 * index of the item on now, `-1` for none, and how many there are. From none, the forward arrow
 * moves to the first and the back arrow to the last.
 */
export function roving(
    key: string,
    orientation: 'vertical' | 'horizontal',
    locate: () => readonly [at: number, length: number],
    wrap = true,
): number {
    const vertical = orientation === 'vertical'
    const forward = key === (vertical ? 'ArrowDown' : 'ArrowRight')
    const back = key === (vertical ? 'ArrowUp' : 'ArrowLeft')
    if (!forward && !back && key !== 'Home' && key !== 'End') return -1
    const [at, length] = locate()
    if (length === 0) return -1
    const last = length - 1
    if (forward) return at === -1 ? 0 : at === last ? (wrap ? 0 : last) : at + 1
    if (back) return at === -1 ? last : at === 0 ? (wrap ? last : 0) : at - 1
    return key === 'Home' ? 0 : last
}
