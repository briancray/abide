// 51.45-51.60, 51.79-51.83 — A TABLE SORTED BY ITS HEADERS AND PICKED BY ITS ROWS, as parts an app
// spreads onto a `<table>` of its own: each header's `aria-sort` and the press that sorts by it, the rows
// in the order the sort names, and a native checkbox per row with a Shift-click range and a header box
// that is mixed while some rows are picked. The app writes every cell.

import type { Column } from './Column.ts'
import { type Reactive, reactive, watch } from './reactive/index.ts'
import type { Sort } from './Sort.ts'
import { cellText, sortRows } from './sortRows.ts'

/** A value `sortableTable` reads as it is used: the value itself, or a function answering it, read live. */
type Live<Value> = Value | (() => Value)

/** The rows and columns of a sortable table, how a row is told apart, and its sort and selection. */
export type SortableTableOptions<Row> = {
    /** The rows, in the order they show while no column is sorted. */
    rows: Live<readonly Row[]>
    /** The columns: what each sorts by, shows and lines up on. */
    columns: Live<readonly Column<Row>[]>
    /** What tells one row from another, so a re-sort moves each row rather than rewriting it. */
    key(row: Row): string
    /** The column sorted by and its direction: hand it a `Reactive` to read and set the sort. */
    sort?: Reactive<Sort | undefined>
    /** The keys of the rows picked: hand it a `Reactive` to read and set the selection (51.79). */
    selected?: Reactive<readonly string[] | undefined>
}

/** The parts `sortableTable` hands back, each spread onto an element: `<tr {...deals.row(deal)}>`. */
export type SortableTableParts<Row> = {
    /** The rows in the order the sort names: what a keyed `{#for}` walks. */
    rows(): readonly Row[]
    /** A header cell: its `scope`, `aria-sort`, `data-sort` and `data-align`. */
    header(column: Column<Row>): Record<string, unknown>
    /** The button in a header that sorts by its column (51.53). */
    sort(column: Column<Row>): Record<string, unknown>
    /** A row: `data-selected` while it is picked. */
    row(row: Row): Record<string, unknown>
    /** A body cell: its `data-align`. */
    cell(column: Column<Row>): Record<string, unknown>
    /** The text a cell shows for a column: its `format`, or its value's own. */
    text(row: Row, column: Column<Row>): string
    /** A row's checkbox: checked while the row is picked, a Shift-click picking the run from the last (51.81). */
    select(row: Row): Record<string, unknown>
    /** The header's checkbox: checked where every row is picked, mixed where some are (51.82). */
    readonly selectAll: Record<string, unknown>
}

const read = <Value>(live: Live<Value>): Value =>
    typeof live === 'function' ? (live as () => Value)() : live

/** A table sorted by its headers and picked by its rows, as parts to spread onto markup of one's own. */
export function sortableTable<Row>(
    options: SortableTableOptions<Row>,
): SortableTableParts<Row> {
    const { key } = options
    const sort = options.sort ?? reactive<Sort | undefined>(undefined)
    const selected =
        options.selected ?? reactive<readonly string[] | undefined>(undefined)
    const rows = () => read(options.rows)
    const columns = () => read(options.columns)

    const sorted = reactive(() => sortRows(rows(), columns(), sort()))

    // 51.53 — a header pressed again turns its direction round; a new one sorts its first direction.
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

    // 51.79-51.83 — ROWS PICKED BY NATIVE CHECKBOXES: a table is no grid, so each row's checkbox is in
    // the page's tab order and Space toggles it as the browser does, with nothing to rove.
    const picked = reactive(() => new Set(selected()))
    // Read only where the header's box is spread, so a table with nothing selectable holds no value
    // that waits on its rows.
    const every = () =>
        sorted().length > 0 && sorted().every((row) => picked().has(key(row)))
    const some = () =>
        !every() && sorted().some((row) => picked().has(key(row)))
    // The row a click last checked or cleared, which a Shift-click runs a range from (51.81).
    let anchor: string | undefined

    function toggle(row: Row, event: MouseEvent) {
        const order = sorted.peek() as readonly Row[]
        const holding = picked.peek() as Set<string>
        const checked = !holding.has(key(row))
        const at = order.findIndex((each) => key(each) === key(row))
        const from =
            event.shiftKey && anchor !== undefined
                ? order.findIndex((each) => key(each) === anchor)
                : -1
        const keys =
            from === -1
                ? [key(row)]
                : order
                      .slice(Math.min(from, at), Math.max(from, at) + 1)
                      .map(key)
        anchor = key(row)
        const next = new Set(holding)
        for (const each of keys) {
            if (checked) next.add(each)
            else next.delete(each)
        }
        // 51.80 — the selection keeps the rows' order.
        selected.set(
            rows()
                .map(key)
                .filter((each) => next.has(each)),
        )
    }

    return {
        rows: () => sorted(),
        header: (column) => ({
            scope: 'col',
            get 'aria-sort'() {
                return directionOf(column)
            },
            get 'data-sort'() {
                return directionOf(column)
            },
            'data-align': column.align,
        }),
        sort: (column) => ({
            type: 'button',
            onclick: () => sortBy(column),
        }),
        row: (row) => ({
            get 'data-selected'() {
                return picked().has(key(row)) ? '' : undefined
            },
        }),
        cell: (column) => ({ 'data-align': column.align }),
        text: cellText,
        select: (row) => ({
            type: 'checkbox',
            get 'aria-label'() {
                const first = columns()[0]
                return `Select ${first === undefined ? key(row) : cellText(row, first)}`
            },
            get checked() {
                return picked().has(key(row))
            },
            onclick: (event: MouseEvent) => toggle(row, event),
        }),
        selectAll: {
            type: 'checkbox',
            'aria-label': 'Select every row',
            get checked() {
                return every()
            },
            // 51.82 — the header's box, toggling every row.
            onclick: () => selected.set(every() ? [] : rows().map(key)),
            // Mixed is a property with no attribute, so it is set on the element itself.
            'bind:element': (input: HTMLInputElement) =>
                watch(() => {
                    input.indeterminate = some()
                }),
        },
    }
}
