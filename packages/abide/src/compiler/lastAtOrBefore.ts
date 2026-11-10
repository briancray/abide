/**
 * The index of the last of `items` whose key is at or before `offset`, or -1 where none is.
 * `items` are ascending by `keyOf`.
 */
export function lastAtOrBefore<Item>(
    items: readonly Item[],
    keyOf: (item: Item) => number,
    offset: number,
): number {
    let low = 0
    let high = items.length
    while (low < high) {
        const middle = (low + high) >>> 1
        if (keyOf(items[middle] as Item) <= offset) low = middle + 1
        else high = middle
    }
    return low - 1
}
