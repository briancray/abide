import type { Column } from './Column.ts'
import { LOCALE } from './LOCALE.ts'
import type { Sort } from './Sort.ts'

// `numeric` orders "deal 9" before "deal 10"; one collator, built once, compares every string — in
// abide's locale rather than the runtime's, so rows a server sorted are in the order hydration sorts.
const COLLATOR = new Intl.Collator(LOCALE, { numeric: true })

/** A column's value for `row`: what `value` hands back, or the row's field named by `key`. */
function valueOf<Row>(row: Row, column: Column<Row>): unknown {
    return column.value
        ? column.value(row)
        : (row as Record<string, unknown>)[column.key]
}

/** The text a cell shows: `format`'s, or the value's own, and nothing for a blank. */
export function cellText<Row>(row: Row, column: Column<Row>): string {
    const value = valueOf(row, column)
    if (column.format) return column.format(value, row)
    return isBlank(value) ? '' : String(value)
}

/** Whether a value has nothing to sort by: absent, empty, or a number or date that is not one. */
function isBlank(value: unknown): boolean {
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
 * `rows` in the order `sort` names: by the column's value, rows of equal value kept in the order they
 * came, and a blank value last whichever the direction. Hands back `rows` itself where `sort` names
 * no column.
 */
export function sortRows<Row>(
    rows: readonly Row[],
    columns: readonly Column<Row>[],
    sort: Sort | undefined,
): readonly Row[] {
    if (sort === undefined) return rows
    let column: Column<Row> | undefined
    for (const each of columns) if (each.key === sort.key) column = each
    if (column === undefined) return rows
    // Each row's value read once, rather than twice per comparison.
    const values: unknown[] = new Array(rows.length)
    const blank: boolean[] = new Array(rows.length)
    const order: number[] = new Array(rows.length)
    for (let at = 0; at < rows.length; at += 1) {
        const value = valueOf(rows[at] as Row, column)
        blank[at] = isBlank(value)
        values[at] = comparable(value)
        order[at] = at
    }
    const sign = sort.direction === 'descending' ? -1 : 1
    order.sort((left, right) => {
        const leftBlank = blank[left] as boolean
        if (leftBlank !== blank[right]) return leftBlank ? 1 : -1
        if (leftBlank) return 0
        return sign * compare(values[left], values[right])
    })
    const sorted: Row[] = new Array(rows.length)
    for (let at = 0; at < order.length; at += 1)
        sorted[at] = rows[order[at] as number] as Row
    return sorted
}
