import { LOCALE } from './LOCALE.ts'

// `numeric` orders "deal 9" before "deal 10"; one collator, built once, compares every string — in
// abide's locale rather than the runtime's, so rows a server sorted are in the order hydration sorts.
const COLLATOR = new Intl.Collator(LOCALE, { numeric: true })

/** Whether a value has nothing to sort by: absent, empty, or a number or date that is not one. */
export function isBlank(value: unknown): boolean {
    if (value === undefined || value === null || value === '') return true
    if (typeof value === 'number') return Number.isNaN(value)
    if (value instanceof Date) return Number.isNaN(value.getTime())
    return false
}

/** What a value sorts as: a date by its time, a number or a bigint or a boolean as itself. */
function comparable(value: unknown): unknown {
    return value instanceof Date ? value.getTime() : value
}

function compare(left: unknown, right: unknown): number {
    const leftType = typeof left
    if (
        leftType === typeof right &&
        (leftType === 'number' ||
            leftType === 'bigint' ||
            leftType === 'boolean')
    )
        return left === right
            ? 0
            : (left as number) < (right as number)
              ? -1
              : 1
    return COLLATOR.compare(String(left), String(right))
}

/**
 * `items` ordered by the value `value` answers for each: items of equal value kept in the order they
 * came, a blank value last whichever the direction, text compared in abide's locale with its numerals
 * by value. A new array; `items` is left as it is.
 *
 * @param items what is sorted
 * @param value what an item sorts by: a number, a bigint, a boolean, a `Date` or text
 * @param direction `'ascending'` unless `'descending'` is given
 */
export function sortBy<Item>(
    items: readonly Item[],
    value: (item: Item) => unknown,
    direction: 'ascending' | 'descending' = 'ascending',
): Item[] {
    // Each item's value read once, rather than twice per comparison.
    const values: unknown[] = new Array(items.length)
    const blank: boolean[] = new Array(items.length)
    const order: number[] = new Array(items.length)
    for (let at = 0; at < items.length; at += 1) {
        const read = value(items[at] as Item)
        blank[at] = isBlank(read)
        values[at] = comparable(read)
        order[at] = at
    }
    const sign = direction === 'descending' ? -1 : 1
    order.sort((left, right) => {
        const leftBlank = blank[left] as boolean
        if (leftBlank !== blank[right]) return leftBlank ? 1 : -1
        if (leftBlank) return 0
        return sign * compare(values[left], values[right])
    })
    const sorted: Item[] = new Array(items.length)
    for (let at = 0; at < order.length; at += 1)
        sorted[at] = items[order[at] as number] as Item
    return sorted
}
