import type { Column } from './Column.ts'
import type { Sort } from './Sort.ts'
import { isBlank, sortBy } from './sortBy.ts'

// What `sortableTable` sorts and writes by a `Column`: internal, over `sortBy` (51.49-51.51).

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

/** `rows` in the order `sort` names, by its column's value; `rows` itself where it names no column. */
export function sortRows<Row>(
    rows: readonly Row[],
    columns: readonly Column<Row>[],
    sort: Sort | undefined,
): readonly Row[] {
    if (sort === undefined) return rows
    let column: Column<Row> | undefined
    for (const each of columns) if (each.key === sort.key) column = each
    if (column === undefined) return rows
    const by = column
    return sortBy(rows, (row) => valueOf(row, by), sort.direction)
}
