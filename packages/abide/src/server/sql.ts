// 47.32-47.34 — SQL AS A TAG, AND WHAT IT READ.
//
// A statement is written once per call site: the strings of a tagged template are one array for as
// long as the module lives, so the array is the key of the statement prepared for it, and every
// value interpolated is a parameter bound to it — never text. An array interpolated is a list of
// them, `(?, ?, ?)`, so a call site is one statement per length of each list it is handed (47.37).
//
// WHAT A STATEMENT READS IS WHAT SQLITE COMPILED IT TO. `EXPLAIN` lists the b-trees the program
// opens: `OpenRead` for what it reads and `OpenWrite` (or `Clear`) for what it writes, each by its
// root page, which `sqlite_schema` maps to the table it belongs to — an index to its table, a view
// to the tables under it, a join, a subquery or a CTE to every table it reaches. Asked once per
// statement prepared, so a call pays a bound run of a prepared statement and a set walk.

import type { Database, SQLQueryBindings, Statement } from 'bun:sqlite'

import { preparedConnection, readTables, wroteTables } from './table.ts'

/** The tag an opener's `sql` is: rows, typed as the caller says they are. */
export type Sql = <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: (SQLQueryBindings | readonly SQLQueryBindings[])[]
) => Row[]

/** 47.37 — an empty list: a subquery answering no row, which `IN` matches nothing and `NOT IN` all. */
const NO_ROWS = '(SELECT NULL WHERE 0)'

type Prepared = {
    statement: Statement
    reads: string[]
    writes: string[]
}

/**
 * 47.32, 47.37 — what each call site's statement is on each `Database`, per the lengths of the lists
 * handed it (`''` where it is handed none): the statement, and its tables.
 */
const PREPARED = new WeakMap<
    TemplateStringsArray,
    WeakMap<Database, Map<string, Prepared>>
>()

/** 47.32 — the `sql` tag over the `Database` `acquire` hands back, `owner` the watches' key. */
export function sqlOver(owner: object, acquire: () => Database): Sql {
    // One connection per table, each making the table's change log as it is reached (47.26).
    const connections = new Map<string, () => Database>()
    const connectionFor = (name: string): (() => Database) => {
        let connection = connections.get(name)
        if (connection === undefined) {
            connection = preparedConnection(acquire, name)
            connections.set(name, connection)
        }
        return connection
    }
    return <Row>(
        strings: TemplateStringsArray,
        ...values: (SQLQueryBindings | readonly SQLQueryBindings[])[]
    ): Row[] => {
        const db = acquire()
        let perDatabase = PREPARED.get(strings)
        if (perDatabase === undefined) {
            perDatabase = new WeakMap()
            PREPARED.set(strings, perDatabase)
        }
        let perShape = perDatabase.get(db)
        if (perShape === undefined) {
            perShape = new Map()
            perDatabase.set(db, perShape)
        }
        // The common call is handed no list, and pays one walk of its values to know it.
        let lengths = ''
        for (let at = 0; at < values.length; at += 1) {
            const value = values[at]
            if (Array.isArray(value)) lengths += `${at}:${value.length},`
        }
        let prepared = perShape.get(lengths)
        if (prepared === undefined) {
            prepared = prepare(db, textOf(strings, values))
            perShape.set(lengths, prepared)
        }
        const bound =
            lengths === '' ? (values as SQLQueryBindings[]) : flattened(values)
        const rows = prepared.statement.all(...bound) as Row[]
        for (const name of prepared.reads)
            readTables(owner, connectionFor(name), [name])
        for (const name of prepared.writes)
            wroteTables(owner, connectionFor(name), [name])
        return rows
    }
}

/** 47.37 — the statement's text: a `?` per value, and a list of them per array. */
function textOf(
    strings: TemplateStringsArray,
    values: readonly (SQLQueryBindings | readonly SQLQueryBindings[])[],
): string {
    let text = strings[0] as string
    for (let at = 0; at < values.length; at += 1) {
        const value = values[at]
        if (!Array.isArray(value)) text += '?'
        else if (value.length === 0) text += NO_ROWS
        else text += `(${new Array(value.length).fill('?').join(', ')})`
        text += strings[at + 1] as string
    }
    return text
}

/** 47.37 — the values bound, each list's spread in its place; a list nested in one is refused. */
function flattened(
    values: readonly (SQLQueryBindings | readonly SQLQueryBindings[])[],
): SQLQueryBindings[] {
    const bound: SQLQueryBindings[] = []
    for (const value of values) {
        if (!Array.isArray(value)) {
            bound.push(value as SQLQueryBindings)
            continue
        }
        for (const each of value as SQLQueryBindings[]) {
            if (Array.isArray(each))
                throw new Error(
                    'abide: sql was handed a list inside a list, which binds as no value. RULEBOOK 47.37.',
                )
            bound.push(each)
        }
    }
    return bound
}

/** The statement for `text`, and the app's tables it reads and writes, from its program (47.32). */
function prepare(db: Database, text: string): Prepared {
    const statement = db.prepare(text)
    const roots = new Map<number, string>()
    for (const { rootpage, tbl_name } of db
        .query(
            "SELECT rootpage, tbl_name FROM sqlite_schema WHERE rootpage > 0 AND tbl_name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND tbl_name NOT LIKE 'abide\\_%' ESCAPE '\\'",
        )
        .all() as { rootpage: number; tbl_name: string }[])
        roots.set(rootpage, tbl_name)
    const reads = new Set<string>()
    const writes = new Set<string>()
    // FINALIZED, not cached: a bun:sqlite `EXPLAIN` statement left standing holds its read open, so
    // the connection reads one snapshot from then on, and no transaction on it can commit.
    const explain = db.prepare(`EXPLAIN ${text}`)
    const program = explain.all() as {
        opcode: string
        p1: number
        p2: number
        p3: number
    }[]
    explain.finalize()
    for (const { opcode, p1, p2, p3 } of program) {
        // Only the main database's: a temp or an attached one is no table an opener watches.
        if (opcode === 'OpenRead' && p3 === 0) {
            const name = roots.get(p2)
            if (name !== undefined) reads.add(name)
        } else if (opcode === 'OpenWrite' && p3 === 0) {
            const name = roots.get(p2)
            if (name !== undefined) writes.add(name)
        } else if (opcode === 'Clear' && p2 === 0) {
            const name = roots.get(p1)
            if (name !== undefined) writes.add(name)
        }
    }
    // A table a statement writes it is no reader of: an UPDATE opens what it reads for writing.
    for (const name of writes) reads.delete(name)
    return { statement, reads: [...reads], writes: [...writes] }
}
