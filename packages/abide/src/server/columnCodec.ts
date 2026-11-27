// 47.40-47.42 — A COLUMN IS READ AS ITS DECLARED TYPE SAYS. SQLite keeps the type a `CREATE TABLE`
// writes for a column verbatim, so `BOOLEAN` and `JSON` are the schema telling the reader what a value
// in that column is; every other declared type is read as SQLite hands it over.

/** What a value in a column is, where its declared type says more than SQLite's storage does. */
export type ColumnCodec = 'boolean' | 'json'

/** A column of a row read, and what its values are. */
export type CodedColumn = { column: string; codec: ColumnCodec }

/** 47.40 — the codec a declared type names: `BOOLEAN` or `BOOL`, and `JSON`, in any case. */
export function codecOf(
    declared: string | null | undefined,
): ColumnCodec | undefined {
    if (declared === null || declared === undefined) return undefined
    const type = declared.trim().toUpperCase()
    if (type === 'BOOLEAN' || type === 'BOOL') return 'boolean'
    if (type === 'JSON') return 'json'
    return undefined
}

/**
 * 47.41 — a value read from a coded column: a boolean from SQLite's integer, a JSON column's text
 * parsed. A `JSON` column's affinity is NUMERIC, so a number written as JSON is stored as the number,
 * and a value that is not text is already what it says. NULL is `null` either way.
 */
export function decoded(codec: ColumnCodec, value: unknown): unknown {
    if (value === null || value === undefined) return value
    if (codec === 'boolean')
        return typeof value === 'bigint' ? value !== 0n : value !== 0
    return typeof value === 'string' ? JSON.parse(value) : value
}

/**
 * 47.42 — a value written to a coded column: JSON text for a `JSON` column, `null` and `undefined`
 * left as they are. A boolean binds as SQLite's 1 and 0 on its own.
 */
export function encoded(codec: ColumnCodec, value: unknown): unknown {
    if (codec === 'json' && value !== null && value !== undefined)
        return JSON.stringify(value)
    return value
}

/** 47.41 — each row's coded columns decoded in place: its shape is unchanged, only values replaced. */
export function decodeRows<Row>(
    rows: Row[],
    coded: readonly CodedColumn[],
): Row[] {
    if (coded.length === 0) return rows
    for (const row of rows) {
        const record = row as Record<string, unknown>
        for (const { column, codec } of coded)
            if (column in record)
                record[column] = decoded(codec, record[column])
    }
    return rows
}
