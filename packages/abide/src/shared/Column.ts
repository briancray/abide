/** One column of a sortable table: what its header says, what it sorts by, and what its cells show. */
export type Column<Row> = {
    /** Names the column in a `Sort`, and is the row field read where `value` is absent. */
    key: string
    /** The header's text, written in the header's sort button. */
    label: string
    /** The side the column's cells sit on, written as `data-align` on its header and its cells. */
    align?: 'start' | 'end'
    /** The value the column sorts by and hands `format`, where the row's `key` field is not it. */
    value?(row: Row): unknown
    /** The text a cell shows for its value, where the value's own text is not it. */
    format?(value: unknown, row: Row): string
    /** `false` for a column whose header does not sort. */
    sortable?: boolean
}
