// 51.47-51.54, 51.72-51.76 — A TABLE SORTED BY ITS HEADERS AND PICKED BY ITS ROWS, as parts an app
// spreads onto a `<table>` of its own: each header's `aria-sort` and the press that sorts by it, the rows
// in the order the sort names, and a native checkbox per row with a Shift-click range and a header box
// that is mixed while some rows are picked. The app writes every cell.

import type { Column } from './Column.ts'
import { keyOfItem, type KeyOption } from './itemKey.ts'
import { type Live, live } from './live.ts'
import { memo, type Reactive, reactive, watch } from './reactive/index.ts'
import { runOf } from './Selection.ts'
import type { Sort } from './Sort.ts'
import { cellText, sortRows } from './sortRows.ts'

/** The rows and columns of a sortable table, how a row is told apart, and its sort and selection. */
export type SortableTableOptions<Row> = {
    /** The rows, in the order they show while no column is sorted. */
    rows: Live<readonly Row[]>
    /** The columns: what each sorts by, shows and lines up on. */
    columns: Live<readonly Column<Row>[]>
    /** The column sorted by and its direction: hand it a `Reactive` to read and set the sort. */
    sort?: Reactive<Sort | undefined>
    /** The keys of the rows picked: hand it a `Reactive` to read and set the selection (51.72). */
    selected?: Reactive<readonly string[] | undefined>
} & KeyOption<Row>

/** One column's parts: its header cell, the button in it that sorts, and its body cells. */
export type SortableTableColumn = {
    /** The header cell: its `scope`, `aria-sort`, `data-sort` and `data-align`. */
    readonly header: Record<string, unknown>
    /** The button in the header that sorts by the column (51.50). */
    readonly sort: Record<string, unknown>
    /** A body cell of the column: its `data-align`. */
    readonly cell: Record<string, unknown>
}

/** One row's parts: the row, the cell holding its checkbox, the checkbox, and a detail row under it. */
export type SortableTableRow = {
    /** The row: `data-selected` while it is picked. */
    readonly row: Record<string, unknown>
    /** The cell holding the row's checkbox. */
    readonly select: Record<string, unknown>
    /** The row's checkbox: checked while the row is picked, a Shift-click picking the run from the last (51.74). */
    readonly checkbox: Record<string, unknown>
    /** A row of detail shown under it. */
    readonly detail: Record<string, unknown>
}

/** The parts `sortableTable` hands back, each spread onto an element: `<tr {...deals.row(deal).row}>`. */
export type SortableTableParts<Row> = {
    /** The table. */
    readonly table: Record<string, unknown>
    /** The rows in the order the sort names: what a keyed `{#for}` walks. */
    get rows(): readonly Row[]
    /** One column's parts. */
    column(column: Column<Row>): SortableTableColumn
    /** One row's parts. */
    row(row: Row): SortableTableRow
    /** The text a cell shows for a column: its `format`, or its value's own. */
    text(row: Row, column: Column<Row>): string
    /** The header's cell holding the checkbox, and the checkbox: checked where every row is picked, mixed where some are (51.75). */
    readonly selectAll: {
        readonly select: Record<string, unknown>
        readonly checkbox: Record<string, unknown>
    }
    /** The column sorted by and its direction, read and set. */
    readonly sort: Reactive<Sort | undefined>
    /** The keys of the rows picked, read and set. */
    readonly selected: Reactive<readonly string[] | undefined>
}

/** A table sorted by its headers and picked by its rows, as parts to spread onto markup of one's own. */
export function sortableTable<Row>(
    options: SortableTableOptions<Row>,
): SortableTableParts<Row> {
    // 49.11 — read where it is used.
    const key = (row: Row) => keyOfItem(options.key, row)
    const sort = options.sort ?? reactive<Sort | undefined>(undefined)
    const selected =
        options.selected ?? reactive<readonly string[] | undefined>(undefined)
    const rows = () => live(options.rows)
    const columns = () => live(options.columns)

    const sorted = memo(() => sortRows(rows(), columns(), sort()))

    // 51.50 — a header pressed again turns its direction round; a new one sorts its first direction.
    function sortBy(column: Column<Row>) {
        const standing = sort.peek()
        sort.set(
            standing?.key === column.key
                ? {
                      key: column.key,
                      direction:
                          standing.direction === 'ascending'
                              ? 'descending'
                              : 'ascending',
                  }
                : {
                      key: column.key,
                      direction: column.firstDirection ?? 'ascending',
                  },
        )
    }
    const directionOf = (column: Column<Row>) => {
        const standing = sort()
        return standing?.key === column.key ? standing.direction : undefined
    }

    // 51.72-51.76 — ROWS PICKED BY NATIVE CHECKBOXES: a table is no grid, so each row's checkbox is in
    // the page's tab order and Space toggles it as the browser does, with nothing to rove.
    const picked = memo(() => new Set(selected()))
    // Read only where the header's box is spread, so a table with nothing selectable holds no value
    // that waits on its rows.
    const every = () =>
        sorted().length > 0 && sorted().every((row) => picked().has(key(row)))
    const some = () =>
        !every() && sorted().some((row) => picked().has(key(row)))
    // The row a click last checked or cleared, which a Shift-click runs a range from (51.74).
    let anchor: string | undefined

    function toggle(row: Row, event: MouseEvent) {
        const order = sorted.peek() as readonly Row[]
        const holding = picked.peek() as Set<string>
        const checked = !holding.has(key(row))
        // 51.74 — Shift runs from the last row clicked, the run checked or cleared with this one.
        const keys = (event.shiftKey && anchor !== undefined
            ? runOf(order.map(key), anchor, key(row))
            : undefined) ?? [key(row)]
        anchor = key(row)
        const next = new Set(holding)
        for (const each of keys) {
            if (checked) next.add(each)
            else next.delete(each)
        }
        // 51.73 — the selection keeps the rows' order.
        selected.set(
            rows()
                .map(key)
                .filter((each) => next.has(each)),
        )
    }

    return {
        table: { 'data-sortable-table': 'table' },
        get rows() {
            return sorted()
        },
        column: (column) => ({
            header: {
                scope: 'col',
                'data-sortable-table': 'header',
                get 'aria-sort'() {
                    return directionOf(column)
                },
                get 'data-sort'() {
                    return directionOf(column)
                },
                'data-align': column.align,
            },
            sort: {
                type: 'button',
                'data-sortable-table': 'sort',
                onclick: () => sortBy(column),
            },
            cell: { 'data-sortable-table': 'cell', 'data-align': column.align },
        }),
        row: (row) => ({
            row: {
                'data-sortable-table': 'row',
                get 'data-selected'() {
                    return picked().has(key(row)) ? '' : undefined
                },
            },
            select: { 'data-sortable-table': 'select' },
            checkbox: {
                type: 'checkbox',
                'data-sortable-table': 'checkbox',
                get 'aria-label'() {
                    const first = columns()[0]
                    return `Select ${first === undefined ? key(row) : cellText(row, first)}`
                },
                get checked() {
                    return picked().has(key(row))
                },
                onclick: (event: MouseEvent) => toggle(row, event),
            },
            detail: { 'data-sortable-table': 'detail' },
        }),
        text: cellText,
        selectAll: {
            select: { scope: 'col', 'data-sortable-table': 'select' },
            checkbox: {
                type: 'checkbox',
                'data-sortable-table': 'checkbox',
                'aria-label': 'Select every row',
                get checked() {
                    return every()
                },
                // 51.75 — the header's box, toggling every row.
                onclick: () => selected.set(every() ? [] : rows().map(key)),
                // Mixed is a property with no attribute, so it is set on the element itself.
                'bind:element': (input: HTMLInputElement) =>
                    watch(() => {
                        input.indeterminate = some()
                    }),
            },
        },
        sort,
        selected,
    }
}
