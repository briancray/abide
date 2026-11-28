// 47.22-47.28 — A TABLE AS A STREAM PAIR: its changes read out, and rows written in.
//
// THE CHANGES ARE CAPTURED IN THE WRITER'S TRANSACTION. Triggers on the table append each insert,
// update and delete to `abide_table_log` as part of the statement that made it, so whoever wrote the
// row — this pair, an ORM, raw SQL, another process, a foreign key's cascade — a committed write is
// one change and a rolled back one is none. The log is a ledger's (58.9): the triggers append to it,
// `readable` is a ledger read of it, and the one poll every log in SQLite is watched by (58.18) is
// how a commit another connection makes is heard.
//
// A TABLE IS DESCRIBED BY ITS DATABASE (47.37): its columns, the type each declares and its primary
// key are read from the file once per connection, so the key a write upserts by is the table's own and
// a `BOOLEAN` or `JSON` column is read and written as one, with nothing said in code.
//
// A WRITE IS BUFFERED AND COMMITTED IN BATCHES: rows written in one turn of the event loop are one
// transaction, so a stream written as fast as it reads pays one commit per batch, not per row.

import type { Database } from 'bun:sqlite'

import { isPlainData } from '#shared/isPlainData.ts'
import { type Ledger, ledger } from '#shared/ledger.ts'
import { namedLogger } from '#shared/log.ts'
import type { Match } from '#shared/Match.ts'
import { SOURCE_KIND } from '#shared/SOURCE_KIND.ts'

import { bindList, listText, slotsOf } from './boundList.ts'
import {
    codecOf,
    type CodedColumn,
    type ColumnCodec,
    decodeRows,
    encoded,
} from './columnCodec.ts'
import type { Typed, Untyped } from './MigratedTables.ts'
import { SQL_IDENTIFIER } from './SQL_IDENTIFIER.ts'
import {
    lastSql,
    logTables,
    type SqliteLog,
    sqliteLog,
} from './stores/sqliteLog.ts'

const WATCH_LOG = namedLogger('abide:table')

/** 47.23 — the tables a table's change log is kept in: `abide_table_log` and those beside it. */
const CHANGE_LOG = 'abide_table'

/** 47.28 — the changes kept per table once every look has passed them. */
const CHANGES_KEPT = 10_000

/** The largest batch one transaction commits. */
const BATCH = 512

/** One change to a row: what it is now, and what it was. */
export type Change<Row> = {
    op: 'insert' | 'update' | 'delete'
    row: Row | undefined
    previous: Row | undefined
}

export type { ColumnMatch, Match } from '#shared/Match.ts'

/**
 * A table of the app's database: its rows read by calling it, rows written by key, its changes read
 * out and rows streamed in.
 */
export type Table<Row, Written = Row, Inserted = Written> = ((
    match?: Match<Row>,
) => Row[]) & {
    /** 47.49 — rows inserted, their key assigned where SQLite assigns it, answered as stored. */
    insert(rows: Inserted | readonly Inserted[]): Row[]
    /** 47.30 — rows upserted by key: inserted, or replacing the row with their key. */
    upsert(rows: Written | readonly Written[]): void
    /** 47.30 — the columns each row names written onto the row with its key; the rest are left. */
    update(rows: Partial<Row> | readonly Partial<Row>[]): void
    /** 47.30 — the rows `match` names deleted, and how many there were. */
    delete(match: Match<Row>): number
    readonly readable: ReadableStream<Change<Row>>
    readonly writable: WritableStream<Written>
    /**
     * 47.51 — this same table, the columns `Narrow` names typed as it says: a JSON column's value, or
     * a text column's union. The checker's alone; nothing changes at run time.
     */
    as<
        Narrow extends {
            [Column in keyof Narrow]: Column extends keyof Row
                ? Row[Column]
                : never
        },
    >(): Table<
        Narrowed<Row, Narrow>,
        Narrowed<Written, Narrow>,
        Narrowed<Inserted, Narrow>
    >
}

/** `Shape` with the columns `Narrow` names typed as `Narrow` types them, optional where they were. */
type Narrowed<Shape, Narrow> = {
    [Column in keyof Shape]: Column extends keyof Narrow
        ? Narrow[Column]
        : Shape[Column]
}

/** What a `table` is told beyond its name: the key it writes by, and the columns its changes carry. */
type TableOptions<Row> = {
    key?: (keyof Row & string) | undefined
    logged?: readonly (keyof Row & string)[] | undefined
}

/** 47.45 — the row a typed opener's table reads, and the row it writes. */
type RowIn<Found, Name extends keyof Found> = Found[Name] extends {
    row: infer Row extends Record<string, unknown>
}
    ? Row
    : never
type WrittenIn<Found, Name extends keyof Found> = Found[Name] extends {
    written: infer Written
}
    ? Written
    : never
type InsertedIn<Found, Name extends keyof Found> = Found[Name] extends {
    inserted: infer Inserted
}
    ? Inserted
    : never

/** 47.46 — a row given by its caller, written: a column that may hold `null` may be left out. */
type WrittenAs<Row> = {
    [
        Column in keyof Row as null extends Row[Column] ? never : Column
    ]: Row[Column]
} & {
    [
        Column in keyof Row as null extends Row[Column] ? Column : never
    ]?: Row[Column]
}

/**
 * A table of `database`: called, its rows, or those `match` names (47.32), a plain read that follows
 * nothing (47.48); `readable` its changes from the moment it is first read, `writable` the rows to
 * upsert by its key (47.22-47.28). A change refreshes the `GET` of an `rpc` over it (47.26).
 */
export function table<Row extends Record<string, unknown> = never>(
    database: Database | (() => Database),
    name: [Row] extends [never] ? never : string,
    // Never inferred from: `logged` naming columns would otherwise make up a row to type the table by.
    options?: NoInfer<TableOptions<Row>>,
): Table<Row, WrittenAs<Row>>
export function table(
    database: Database | ((() => Database) & Untyped),
    name: string,
    options?: TableOptions<Record<string, unknown>>,
): Table<Record<string, unknown>>
export function table<Found, Name extends keyof Found & string>(
    database: (() => Database) & Typed<Found>,
    name: Name,
    options?: NoInfer<TableOptions<RowIn<Found, Name>>>,
): Table<RowIn<Found, Name>, WrittenIn<Found, Name>, InsertedIn<Found, Name>>
export function table<Row extends Record<string, unknown>>(
    database: Database | (() => Database),
    name: string,
    options?: TableOptions<Row>,
): Table<Row> {
    if (!SQL_IDENTIFIER.test(name))
        throw new Error(
            `abide: table ${JSON.stringify(name)} is not an SQL identifier.`,
        )
    const key = options?.key
    if (key !== undefined && !SQL_IDENTIFIER.test(key))
        throw new Error(
            `abide: table ${name}'s key ${JSON.stringify(key)} is not an SQL identifier.`,
        )
    logging(name, options?.logged)
    const acquire = typeof database === 'function' ? database : () => database
    // 47.36 — nothing is opened here: the database, its change log and the table's watch wait for the
    // table's first use, so a module declaring tables can be imported without a file.
    const connection = preparedConnection(acquire, name, key)
    let readable:
        | { stream: ReadableStream<Change<Row>>; ended: () => boolean }
        | undefined
    let writable: WritableStream<Row> | undefined
    // 47.35 — READ ON THE CONNECTION AS IT IS: a database refusing the change log is still read.
    const read = selects<Row>(acquire, name)
    const writes = rowWrites<Row>(name, key)
    // 47.26, 47.31 — a write made here is heard at once: the table's `rpc` is refreshed now, and
    // the watch's next look does not hear it again. 47.41 — save inside a transaction, whose commit
    // the watch's next look hears, and whose rollback it never does.
    const wrote = (db: Database, count: number): number => {
        if (count === 0) return count
        const watch = watchOf(database, connection, name)
        if (watch.broken) changed(watch)
        else if (!db.inTransaction) watch.log.look()
        return count
    }
    const keyed = (db: Database, rows: readonly Partial<Row>[]): void => {
        const columns = keyColumns(describe(db, name), key)
        for (const row of rows)
            for (const column of columns) keyOf(name, column, row)
    }
    const upsert = (rows: Row | readonly Row[]): void => {
        const each = listOf(rows)
        const db = connection()
        keyed(db, each)
        writes.upsert(db, each)
        wrote(db, each.length)
    }
    const update = (rows: Partial<Row> | readonly Partial<Row>[]): void => {
        const each = listOf(rows)
        const db = connection()
        keyed(db, each)
        writes.update(db, each)
        wrote(db, each.length)
    }
    const remove = (match: Match<Row>): number => {
        if (
            match === undefined ||
            match === null ||
            Object.keys(match).length === 0
        )
            throw new Error(
                `abide: a delete from table ${name} names no column, which would delete every row. RULEBOOK 47.30.`,
            )
        const db = connection()
        return wrote(db, read.remove(db, match))
    }
    // 47.48 — the run a call is made in does not follow the table. 47.28 — the call still begins the
    // watch, which keeps the change log short for a table written only by statements of the app's own.
    const called = (match?: Match<Row>): Row[] => {
        const rows = read.rows(match)
        watchOf(database, connection, name)
        return rows
    }
    const insert = (rows: Row | readonly Row[]): Row[] => {
        const each = listOf(rows)
        const db = connection()
        const stored = writes.insert(db, each)
        wrote(db, stored.length)
        return stored
    }
    return Object.defineProperties(called, {
        // 16.117 — read by `rpc` for its face; 47.26 — and the one follower of the table's changes,
        // added by its `rpc`'s read at each run, so a watch the app's stop ended is begun again.
        [SOURCE_KIND]: {
            value: {
                kind: 'table',
                name,
                follow: (heard: () => void): void => {
                    watchOf(database, connection, name).followers.add(heard)
                },
            },
        },
        insert: { value: insert },
        upsert: { value: upsert },
        update: { value: update },
        delete: { value: remove },
        // 47.22 — reached, the table is prepared, and a table the database does not hold throws here.
        readable: {
            get() {
                connection()
                // 47.24 — one stream while it runs; one cancelled or errored is followed by a new one.
                if (readable === undefined || readable.ended())
                    readable = changesOf<Row>(
                        watchOf(database, connection, name),
                        connection,
                        name,
                    )
                return readable.stream
            },
        },
        as: { value: () => called },
        writable: {
            get() {
                connection()
                writable ??= upserts<Row>(connection, writes)
                return writable
            },
        },
    }) as Table<Row>
}

/**
 * 47.37 — a table as its database describes it: its columns, the codec each declared type names, and
 * its primary key's columns in key order.
 */
type Description = {
    columns: Set<string>
    coded: CodedColumn[]
    codecs: Map<string, ColumnCodec>
    primaryKey: string[]
}

/** 47.37 — each `Database`'s tables, described the first time each is reached through it. */
const DESCRIBED = new WeakMap<Database, Map<string, Description>>()

/** 47.37 — `name` as `db` holds it; 47.22 — a table it does not hold is refused. */
function describe(db: Database, name: string): Description {
    let tables = DESCRIBED.get(db)
    if (tables === undefined) {
        tables = new Map()
        DESCRIBED.set(db, tables)
    }
    const standing = tables.get(name)
    if (standing !== undefined) return standing
    const found = db.query(`PRAGMA table_info(${name})`).all() as {
        name: string
        type: string
        pk: number
    }[]
    if (found.length === 0)
        throw new Error(
            `abide: table ${name} is not in the database. RULEBOOK 47.22.`,
        )
    const description: Description = {
        columns: new Set(),
        coded: [],
        codecs: new Map(),
        primaryKey: [],
    }
    const keyed: { column: string; at: number }[] = []
    for (const column of found) {
        if (!SQL_IDENTIFIER.test(column.name)) continue
        description.columns.add(column.name)
        const codec = codecOf(column.type)
        if (codec !== undefined) {
            description.coded.push({ column: column.name, codec })
            description.codecs.set(column.name, codec)
        }
        if (column.pk > 0) keyed.push({ column: column.name, at: column.pk })
    }
    keyed.sort((one, other) => one.at - other.at)
    for (const { column } of keyed) description.primaryKey.push(column)
    tables.set(name, description)
    return description
}

/**
 * 47.27 — the columns a write names its row by: `key` where given, the table's primary key where it
 * declares one, and `id` where it declares none.
 */
function keyColumns(
    description: Description,
    key: string | undefined,
): string[] {
    if (key !== undefined) return [key]
    return description.primaryKey.length > 0 ? description.primaryKey : ['id']
}

/**
 * 47.40 — per table name, the columns its changes carry: the union of every `logged` asked for in this
 * process, or `undefined` once any `table` of it asked for every column.
 */
const LOGGED = new Map<string, Set<string> | undefined>()

function logging(name: string, logged: readonly string[] | undefined): void {
    if (logged === undefined) {
        LOGGED.set(name, undefined)
        return
    }
    for (const column of logged)
        if (!SQL_IDENTIFIER.test(column))
            throw new Error(
                `abide: table ${name}'s logged column ${JSON.stringify(column)} is not an SQL identifier.`,
            )
    if (LOGGED.has(name) && LOGGED.get(name) === undefined) return
    let columns = LOGGED.get(name)
    if (columns === undefined) {
        columns = new Set()
        LOGGED.set(name, columns)
    }
    for (const column of logged) columns.add(column)
}

/** `acquire`'s `Database`, with `name`'s change log and triggers made on it (47.23). */
function preparedConnection(
    acquire: () => Database,
    name: string,
    key: string | undefined,
): () => Database {
    return () => {
        const db = acquire()
        prepare(db, name, key)
        return db
    }
}

/** 47.33 — the comparisons a `ColumnMatch` object may name, each to the operator it is. */
const COMPARISONS: Record<string, string> = {
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    ne: 'IS NOT',
    like: 'LIKE',
}

/**
 * 47.32, 47.33 — the rows of `name`, or those every column `match` names matches: one statement per
 * shape of match — its columns, the slots of each list and the comparisons named — each column
 * checked against the table's own; and 47.30 — the rows a match names deleted, by the same shapes.
 * 47.38 — the rows read with their coded columns decoded.
 */
function selects<Row>(
    acquire: () => Database,
    name: string,
): {
    rows: (match?: Match<Row>) => Row[]
    remove: (db: Database, match: Match<Row>) => number
} {
    const statements = new Map<string, ReturnType<Database['query']>>()
    let preparedOn: Database | undefined
    const shaped = (
        db: Database,
        description: Description,
        match: Match<Row> | undefined,
        verb: 'SELECT *' | 'DELETE',
    ): [ReturnType<Database['query']>, unknown[]] => {
        if (db !== preparedOn) {
            statements.clear()
            preparedOn = db
        }
        const values: unknown[] = []
        const conditions: string[] = []
        if (match !== undefined)
            for (const column in match) {
                const value: unknown = match[column as keyof Row]
                if (value === undefined) continue
                if (!description.columns.has(column))
                    throw new Error(
                        `abide: table ${name} has no column ${JSON.stringify(column)}. RULEBOOK 47.32.`,
                    )
                conditions.push(
                    conditionOf(
                        name,
                        column,
                        description.codecs.get(column),
                        value,
                        values,
                    ),
                )
            }
        const shape = `${verb}|${conditions.join(' AND ')}`
        let statement = statements.get(shape)
        if (statement === undefined) {
            statement = db.query(
                conditions.length === 0
                    ? `${verb} FROM ${name}`
                    : `${verb} FROM ${name} WHERE ${conditions.join(' AND ')}`,
            )
            statements.set(shape, statement)
        }
        return [statement, values]
    }
    return {
        rows: (match) => {
            const db = acquire()
            const description = describe(db, name)
            const [statement, values] = shaped(
                db,
                description,
                match,
                'SELECT *',
            )
            return decodeRows(
                statement.all(...(values as never[])) as Row[],
                description.coded,
            )
        },
        remove: (db, match) => {
            const [statement, values] = shaped(
                db,
                describe(db, name),
                match,
                'DELETE',
            )
            return statement.run(...(values as never[])).changes
        },
    }
}

/** One row or a list of them, as a list. */
function listOf<Row>(rows: Row | readonly Row[]): readonly Row[] {
    return Array.isArray(rows) ? (rows as readonly Row[]) : [rows as Row]
}

/** 47.30 — the key `row` carries, which a write by key cannot go without. */
function keyOf(name: string, key: string, row: unknown): unknown {
    const id = (row as Record<string, unknown> | null)?.[key]
    if (id === undefined || id === null)
        throw new Error(
            `abide: a row written to table ${name} carries no ${key}. RULEBOOK 47.30.`,
        )
    return id
}

/**
 * 47.32, 47.33 — the condition `value` puts on `column`, its values pushed onto `values`, encoded as
 * the column's declared type says (47.39). NULL-SAFE as JSON is: a list holding `null` matches a
 * NULL, and `ne` is `IS NOT`, so a NULL is not a value `ne: 'won'` refuses. An empty list is no
 * value at all and matches no row.
 */
function conditionOf(
    name: string,
    column: string,
    codec: ColumnCodec | undefined,
    value: unknown,
    values: unknown[],
): string {
    const quoted = `"${column}"`
    if (value === null) return `${quoted} IS NULL`
    if (Array.isArray(value)) {
        const listed: unknown[] = []
        let nullable = false
        for (const each of value as unknown[]) {
            if (each === null) nullable = true
            else listed.push(scalarOf(name, column, codec, each))
        }
        const slots = slotsOf(listed.length)
        const among = slots === 0 ? '' : `${quoted} IN ${listText(slots)}`
        if (slots !== 0)
            bindList(listed, slots, values as never[], (reason) => {
                throw new Error(
                    `abide: table ${name}'s match on ${column} holds ${reason}. RULEBOOK 47.33.`,
                )
            })
        if (nullable)
            return among === ''
                ? `${quoted} IS NULL`
                : `(${among} OR ${quoted} IS NULL)`
        return among === '' ? '0' : among
    }
    if (!isPlainObject(value))
        return pushed(
            `${quoted} = ?`,
            values,
            codec === undefined ? value : encoded(codec, value),
        )
    const met: string[] = []
    for (const comparison in value) {
        const operator = COMPARISONS[comparison]
        if (operator === undefined)
            throw new Error(
                `abide: table ${name}'s match on ${column} names ${JSON.stringify(comparison)}, which is none of gt, gte, lt, lte, ne, like. RULEBOOK 47.33.`,
            )
        const bound = value[comparison]
        if (bound === undefined) continue
        if (bound === null) {
            if (comparison !== 'ne')
                throw new Error(
                    `abide: table ${name}'s match on ${column} compares ${comparison} to null, which orders nothing. RULEBOOK 47.33.`,
                )
            met.push(`${quoted} IS NOT NULL`)
            continue
        }
        met.push(
            pushed(
                `${quoted} ${operator} ?`,
                values,
                scalarOf(name, column, codec, bound),
            ),
        )
    }
    // No comparison named is none to meet, as an AND of nothing is.
    return met.length === 0 ? '1' : met.join(' AND ')
}

function pushed(condition: string, values: unknown[], value: unknown): string {
    values.push(value)
    return condition
}

/**
 * A value a list or a comparison holds, which is one value: no list or object nested in it; encoded
 * as its column's declared type says (47.39).
 */
function scalarOf(
    name: string,
    column: string,
    codec: ColumnCodec | undefined,
    value: unknown,
): unknown {
    if (Array.isArray(value) || isPlainObject(value))
        throw new Error(
            `abide: table ${name}'s match on ${column} nests a list or an object where a value goes. RULEBOOK 47.33.`,
        )
    return codec === undefined ? value : encoded(codec, value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !Array.isArray(value) && isPlainData(value)
}

/** Where each `Database` has had its change log made, and each table its triggers, as logged. */
const PREPARED = new WeakMap<Database, Map<string, string>>()

/**
 * 47.22, 47.23 — the change log, and the table's triggers naming every column it has now, or the
 * columns 47.40 logs and its key: made again the first time each `Database` reaches the table, so a
 * column a migration added is captured, and again where this process asks to log more.
 */
function prepare(db: Database, name: string, key: string | undefined): void {
    // 47.52 — WHAT A TRANSACTION MAKES, ITS ROLLBACK UNMAKES: the change log and the triggers made
    // inside one are made again at every reach until a reach outside one makes them for good.
    const lasting = !db.inTransaction
    let tables = PREPARED.get(db)
    if (tables === undefined) {
        logTables(db, CHANGE_LOG)
        // The change log a release before this one kept, and the triggers writing to it.
        const stale = db
            .query(
                "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'abide\\_changes\\_%' ESCAPE '\\'",
            )
            .all() as { name: string }[]
        for (const trigger of stale) db.run(`DROP TRIGGER "${trigger.name}"`)
        for (const old of [
            'abide_changes',
            'abide_changes_removed',
            'abide_changes_log',
        ])
            db.run(`DROP TABLE IF EXISTS ${old}`)
        tables = new Map()
        if (lasting) PREPARED.set(db, tables)
    }
    const description = describe(db, name)
    const logged = LOGGED.get(name)
    let columns: string[]
    if (logged === undefined) columns = [...description.columns]
    else {
        const chosen = new Set(keyColumns(description, key))
        for (const column of logged) {
            if (!description.columns.has(column))
                throw new Error(
                    `abide: table ${name} has no column ${JSON.stringify(column)} to log. RULEBOOK 47.40.`,
                )
            chosen.add(column)
        }
        columns = [...chosen]
    }
    const signature = columns.join(',')
    if (tables.get(name) === signature) return
    const objectOf = (side: 'NEW' | 'OLD'): string => {
        const pairs: string[] = []
        for (const column of columns)
            pairs.push(`'${column}', ${side}."${column}"`)
        return `json_object(${pairs.join(', ')})`
    }
    // 47.53 — an update that leaves every column as it was is no change: an upsert matching a row it
    // writes nothing new to (`DO UPDATE SET x = x`) logs nothing and refreshes no reader.
    const every = [...description.columns].map((column) => `"${column}"`)
    const changing = `WHEN (${every.map((column) => `NEW.${column}`).join(', ')}) IS NOT (${every.map((column) => `OLD.${column}`).join(', ')})`
    const triggers: [string, string, string, string, string][] = [
        ['insert', 'INSERT', '', objectOf('NEW'), 'NULL'],
        ['update', 'UPDATE', changing, objectOf('NEW'), objectOf('OLD')],
        ['delete', 'DELETE', '', 'NULL', objectOf('OLD')],
    ]
    // 58.2 — numbered one past the log's last, kept or let go, as an append through the log numbers it.
    const next = `${lastSql(CHANGE_LOG, `'${name}'`)} + 1`
    const now = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"
    db.transaction(() => {
        for (const [op, event, when, row, previous] of triggers) {
            db.run(`DROP TRIGGER IF EXISTS ${CHANGE_LOG}_${name}_${op}`)
            db.run(
                `CREATE TRIGGER ${CHANGE_LOG}_${name}_${op} AFTER ${event} ON ${name} ${when} BEGIN INSERT INTO ${CHANGE_LOG}_log (log, seq, at, key, entry) VALUES ('${name}', ${next}, ${now}, NULL, json_object('op', '${op}', 'row', ${row}, 'previous', ${previous})); END`,
            )
        }
    })()
    if (lasting) tables.set(name, signature)
}

/**
 * 47.26 — one table's watch: its change log, what each change is told to — the refresh of each `rpc`
 * over the table — whether it has stopped (47.35), the ledger its `readable`s read (47.24), and how
 * far each of them has read, which the watch keeps the log for (47.28).
 */
type Watch = {
    log: SqliteLog
    followers: Set<() => void>
    broken: boolean
    changes: Ledger<Logged> | undefined
    readers: Set<{ position: number }>
}

/** 47.23 — one change as the triggers log it: a row as JSON, `null` where there is none. */
type Logged = {
    op: 'insert' | 'update' | 'delete'
    row: Record<string, unknown> | null
    previous: Record<string, unknown> | null
}

/** 47.26 — per database or opener, each table's watch. */
const WATCHED = new WeakMap<object, Map<string, Watch>>()

/** 47.35 — the databases whose stopped watch has been said. */
const WARNED = new WeakSet<object>()

/** 47.26 — `name`'s watch over `owner`, made at its first use and begun again after the app's stop. */
function watchOf(
    owner: object,
    connection: () => Database,
    name: string,
): Watch {
    let watches = WATCHED.get(owner)
    if (watches === undefined) {
        watches = new Map()
        WATCHED.set(owner, watches)
    }
    const standing = watches.get(name)
    if (standing !== undefined) {
        if (!standing.broken) standing.log.resume()
        return standing
    }
    const watch: Watch = {
        log: sqliteLog(connection, CHANGE_LOG, () => name),
        followers: new Set(),
        broken: false,
        changes: undefined,
        readers: new Set(),
    }
    watches.set(name, watch)
    try {
        connection()
    } catch (thrown) {
        // 47.35 — a database refusing the change log, read-only among them: said once per database,
        // and the writes made through its `table` are then all that refresh.
        watch.broken = true
        if (!WARNED.has(owner)) {
            WARNED.add(owner)
            WATCH_LOG.warning(
                `the watch of ${name} stopped: only writes made through its table refresh its rpc. RULEBOOK 47.35.`,
                thrown,
            )
        }
        return watch
    }
    watch.log.watch?.(() => changed(watch))
    // 47.26 — the baseline taken as the table is first used, so a write before the first look is heard.
    watch.log.resume()
    return watch
}

/** 47.26 — a change to the watched table, told to each `rpc` over it; 47.28 — and the log kept short. */
function changed(watch: Watch): void {
    for (const heard of watch.followers) heard()
    if (watch.broken) return
    let least = Number.POSITIVE_INFINITY
    for (const reader of watch.readers)
        if (reader.position < least) least = reader.position
    const through = Math.min(watch.log.last() - CHANGES_KEPT, least)
    if (through > 0) watch.log.trim(through)
}

/**
 * 47.24, 47.25 — the table's changes from the moment the stream is reached, in order, their coded
 * columns decoded (47.38): a read of the ledger the log is (58.5), so a reader another process trimmed
 * past (58.15) or one over another file's log (58.17) errors.
 */
function changesOf<Row>(
    watch: Watch,
    connection: () => Database,
    name: string,
): { stream: ReadableStream<Change<Row>>; ended: () => boolean } {
    const reading = { position: watch.log.last() }
    watch.readers.add(reading)
    watch.changes ??= ledger<Logged>({ store: watch.log })
    const source = watch.changes(reading.position).getReader()
    let ended = false
    const done = (): void => {
        ended = true
        watch.readers.delete(reading)
    }
    const rowOf = (
        row: Record<string, unknown> | null,
        coded: CodedColumn[],
    ): Row | undefined =>
        row === null ? undefined : (decodeRows([row], coded)[0] as Row)
    const stream = new ReadableStream<Change<Row>>(
        {
            pull: async (controller) => {
                let next: Awaited<ReturnType<typeof source.read>>
                try {
                    next = await source.read()
                } catch (thrown) {
                    done()
                    controller.error(thrown)
                    return
                }
                if (next.done) {
                    done()
                    controller.close()
                    return
                }
                reading.position = next.value.seq
                const { coded } = describe(connection(), name)
                const { op, row, previous } = next.value.entry
                controller.enqueue({
                    op,
                    row: rowOf(row, coded),
                    previous: rowOf(previous, coded),
                })
            },
            cancel: async () => {
                done()
                await source.cancel()
            },
        },
        { highWaterMark: 0 },
    )
    return { stream, ended: () => ended }
}

/**
 * 47.27, 47.30 — rows upserted by their key, or the columns they name updated on the row with their
 * key, each batch one transaction. One statement per shape of row, its columns checked and its SQL
 * written once: a batch of rows with the same columns runs one prepared statement. 47.39 — each value
 * encoded as its column's declared type says.
 */
function rowWrites<Row extends Record<string, unknown>>(
    name: string,
    key: string | undefined,
): RowWrites<Row> {
    const statements = new Map<
        string,
        {
            columns: string[]
            codecs: (ColumnCodec | undefined)[]
            statement: ReturnType<Database['query']>
        }
    >()
    // A statement is its database's: a `connection` handing back another starts the map over.
    let preparedOn: Database | undefined
    const statementFor = (
        db: Database,
        description: Description,
        row: Partial<Row>,
        mode: Mode,
    ) => {
        if (db !== preparedOn) {
            statements.clear()
            preparedOn = db
        }
        // 47.30 — a column whose value is `undefined` is not named, as JSON leaves it out.
        const columns: string[] = []
        for (const column in row)
            if (row[column] !== undefined) columns.push(column)
        const shape = `${mode}:${columns.join(',')}`
        let prepared = statements.get(shape)
        // A cached shape's columns are identifiers, so no comma is in one: a row joining to the same
        // text with another count has a comma in a column, and is checked — and refused — afresh.
        if (
            prepared === undefined ||
            prepared.columns.length !== columns.length
        ) {
            for (const column of columns)
                if (!SQL_IDENTIFIER.test(column))
                    throw new Error(
                        `abide: ${name}'s column ${JSON.stringify(column)} is not an SQL identifier.`,
                    )
            const keys = keyColumns(description, key)
            const quoted: string[] = []
            const slots: string[] = []
            const updates: string[] = []
            const sets: string[] = []
            const others: string[] = []
            for (const column of columns) {
                quoted.push(`"${column}"`)
                slots.push('?')
                if (keys.includes(column)) continue
                others.push(column)
                updates.push(`"${column}" = excluded."${column}"`)
                sets.push(`"${column}" = ?`)
            }
            const conflict =
                updates.length === 0
                    ? 'DO NOTHING'
                    : `DO UPDATE SET ${updates.join(', ')}`
            const target = keys.map((column) => `"${column}"`).join(', ')
            const where = keys.map((column) => `"${column}" = ?`).join(' AND ')
            // An update binds the columns it sets, then the key it names the row by.
            const ordered = mode === 'update' ? [...others, ...keys] : columns
            const inserted =
                columns.length === 0
                    ? `INSERT INTO ${name} DEFAULT VALUES`
                    : `INSERT INTO ${name} (${quoted.join(', ')}) VALUES (${slots.join(', ')})`
            prepared = {
                columns: ordered,
                codecs: ordered.map((column) => description.codecs.get(column)),
                statement: db.query(
                    mode === 'update'
                        ? `UPDATE ${name} SET ${sets.join(', ')} WHERE ${where}`
                        : mode === 'insert'
                          ? `${inserted} RETURNING *`
                          : `${inserted} ON CONFLICT(${target}) ${conflict}`,
                ),
            }
            statements.set(shape, prepared)
        }
        return prepared
    }
    /** Each row's statement run with its values, encoded per 47.39, in one transaction. */
    const each = (
        db: Database,
        rows: readonly Partial<Row>[],
        mode: Mode,
        ran: (
            statement: ReturnType<Database['query']>,
            values: unknown[],
        ) => void,
    ): void => {
        const description = describe(db, name)
        const keys = keyColumns(description, key).length
        db.transaction(() => {
            for (const row of rows) {
                // An update naming no column but its key changes nothing.
                if (mode === 'update' && definedCount(row) <= keys) continue
                const { columns, codecs, statement } = statementFor(
                    db,
                    description,
                    row,
                    mode,
                )
                const values = new Array<unknown>(columns.length)
                for (let at = 0; at < columns.length; at += 1) {
                    const value = row[columns[at] as string]
                    const codec = codecs[at]
                    values[at] =
                        codec === undefined ? value : encoded(codec, value)
                }
                ran(statement, values)
            }
        })()
    }
    const run = (
        statement: ReturnType<Database['query']>,
        values: unknown[],
    ) => {
        statement.run(...(values as never[]))
    }
    return {
        upsert: (db, rows) => each(db, rows, 'upsert', run),
        update: (db, rows) => each(db, rows, 'update', run),
        insert: (db, rows) => {
            const stored: Row[] = []
            each(db, rows, 'insert', (statement, values) => {
                stored.push(statement.get(...(values as never[])) as Row)
            })
            return decodeRows(stored, describe(db, name).coded)
        },
    }
}

/** How a row is written: upserted by its key, updated by it, or inserted and answered. */
type Mode = 'upsert' | 'update' | 'insert'

/** How many of `row`'s columns hold a value: `undefined` is no value (47.30). */
function definedCount(row: object): number {
    let count = 0
    for (const column in row)
        if ((row as Record<string, unknown>)[column] !== undefined) count += 1
    return count
}

type RowWrites<Row> = {
    upsert: (db: Database, rows: readonly Row[]) => void
    update: (db: Database, rows: readonly Partial<Row>[]) => void
    insert: (db: Database, rows: readonly Partial<Row>[]) => Row[]
}

/** 47.27 — rows upserted by their key, a turn's writes one transaction. */
function upserts<Row extends Record<string, unknown>>(
    connection: () => Database,
    writes: RowWrites<Row>,
): WritableStream<Row> {
    let buffered: Row[] = []
    let flushing: Promise<void> | undefined
    let failed: unknown
    let timer: ReturnType<typeof setTimeout> | undefined
    const commit = (rows: Row[]): void => writes.upsert(connection(), rows)
    const flush = (): Promise<void> => {
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
        flushing ??= Promise.resolve().then(() => {
            flushing = undefined
            if (buffered.length === 0) return
            const batch = buffered
            buffered = []
            try {
                commit(batch)
            } catch (thrown) {
                failed = thrown
            }
        })
        return flushing
    }
    return new WritableStream<Row>({
        write: async (row) => {
            if (failed !== undefined) throw failed
            buffered.push(row)
            // 47.27 — a full batch waits for its commit, so a writer faster than the table is held.
            if (buffered.length >= BATCH) {
                await flush()
                if (failed !== undefined) throw failed
                return
            }
            timer ??= setTimeout(() => void flush(), 0)
        },
        close: async () => {
            await flush()
            if (failed !== undefined) throw failed
        },
    })
}
