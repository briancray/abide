// 47.32-47.34 — SQL AS A TAG, AND WHAT IT READ.
//
// A statement is written once per call site: the strings of a tagged template are one array for as
// long as the module lives, so the array is the key of the statement prepared for it, and every
// value interpolated is a parameter bound to it — never text.
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
    ...values: SQLQueryBindings[]
) => Row[]

type Prepared = {
    statement: Statement
    reads: string[]
    writes: string[]
}

/** 47.32 — what each call site's statement is on each `Database`: the statement, and its tables. */
const PREPARED = new WeakMap<
    TemplateStringsArray,
    WeakMap<Database, Prepared>
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
        ...values: SQLQueryBindings[]
    ): Row[] => {
        const db = acquire()
        let perDatabase = PREPARED.get(strings)
        if (perDatabase === undefined) {
            perDatabase = new WeakMap()
            PREPARED.set(strings, perDatabase)
        }
        let prepared = perDatabase.get(db)
        if (prepared === undefined) {
            prepared = prepare(db, strings.join('?'))
            perDatabase.set(db, prepared)
        }
        const rows = prepared.statement.all(...values) as Row[]
        for (const name of prepared.reads)
            readTables(owner, connectionFor(name), [name])
        for (const name of prepared.writes)
            wroteTables(owner, connectionFor(name), [name])
        return rows
    }
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
