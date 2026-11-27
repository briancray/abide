// 47.25-47.31 — A TABLE AS A STREAM PAIR: its changes read out, and rows written in.
//
// THE CHANGES ARE CAPTURED IN THE WRITER'S TRANSACTION. Triggers on the table append each insert,
// update and delete to `abide_changes` as part of the statement that made it, so whoever wrote the
// row — this pair, an ORM, raw SQL, another process, a foreign key's cascade — a committed write is
// one change and a rolled back one is none. bun:sqlite has no update hook, so the changes are read by
// a look at the log's last number, which is an index read; a look that finds nothing new costs that
// alone.
//
// A TABLE IS DESCRIBED BY ITS DATABASE (47.39): its columns, the type each declares and its primary
// key are read from the file once per connection, so the key a write upserts by is the table's own and
// a `BOOLEAN` or `JSON` column is read and written as one, with nothing said in code.
//
// A WRITE IS BUFFERED AND COMMITTED IN BATCHES: rows written in one turn of the event loop are one
// transaction, so a stream written as fast as it reads pays one commit per batch, not per row.

import type { Database } from 'bun:sqlite'

import { isPlainData } from '#shared/isPlainData.ts'
import { namedLogger } from '#shared/log.ts'
import type { Match } from '#shared/Match.ts'
import { appStopSignal } from '#shared/reactive/abortSignal.ts'
import type { Cell } from '#shared/reactive/cellShape.ts'
import { refreshCells } from '#shared/reactive/producer.ts'
import { SCOPING } from '#shared/reactive/scoping.ts'
import { unrefTimer } from '#shared/reactive/unrefTimer.ts'
import { SOURCE_KIND } from '#shared/SOURCE_KIND.ts'

import { bindList, listText, slotsOf } from './boundList.ts'
import {
    codecOf,
    type CodedColumn,
    type ColumnCodec,
    decodeRows,
    encoded,
} from './columnCodec.ts'
import type { Typed, TYPED_TABLES } from './MigratedTables.ts'
import { SQL_IDENTIFIER } from './SQL_IDENTIFIER.ts'

const WATCH_LOG = namedLogger('abide:table')

/** 47.27 — how often a reader or the table's watch looks for changes past the last it saw. */
const LOOK_EVERY = 50

/** 47.31 — the changes kept per table once every look has passed them. */
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
    /** 47.50 — the rows a call would answer, read without the run it is made in following them. */
    peek(match?: Match<Row>): Row[]
    /** 47.51 — rows inserted, their key assigned where SQLite assigns it, answered as stored. */
    insert(rows: Inserted | readonly Inserted[]): Row[]
    /** 47.33 — rows upserted by key: inserted, or replacing the row with their key. */
    set(rows: Written | readonly Written[]): void
    /** 47.33 — the columns each row names written onto the row with its key; the rest are left. */
    patch(rows: Partial<Row> | readonly Partial<Row>[]): void
    /** 47.33 — the rows `match` names deleted, and how many there were. */
    delete(match: Match<Row>): number
    readonly readable: ReadableStream<Change<Row>>
    readonly writable: WritableStream<Written>
}

/** What a `table` is told beyond its name: the key it writes by, and the columns its changes carry. */
type TableOptions<Row> = {
    key?: (keyof Row & string) | undefined
    logged?: readonly (keyof Row & string)[] | undefined
}

/** 47.47 — the row a typed opener's table reads, and the row it writes. */
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

/** 47.48 — a row given by its caller, written: a column that may hold `null` may be left out. */
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
 * A table of `database`: called, its rows, or those `match` names (47.35), a read that refreshes the
 * run it is made in when the table changes (47.29); `readable` its changes from the moment it is first
 * read, `writable` the rows to upsert by its key (47.25-47.31).
 */
export function table<Row extends Record<string, unknown> = never>(
    database: Database | (() => Database),
    name: [Row] extends [never] ? never : string,
    options?: TableOptions<Row>,
): Table<Row, WrittenAs<Row>>
export function table(
    database:
        Database | ((() => Database) & { readonly [TYPED_TABLES]?: undefined }),
    name: string,
    options?: TableOptions<Record<string, unknown>>,
): Table<Record<string, unknown>>
export function table<Found, Name extends keyof Found & string>(
    database: (() => Database) & Typed<Found>,
    name: Name,
    options?: TableOptions<RowIn<Found, Name>>,
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
    // 47.53 — nothing is opened here: the database, its change log and the table's watch wait for the
    // table's first use, so a module declaring tables can be imported without a file.
    const connection = preparedConnection(acquire, name, key)
    let readable: ReadableStream<Change<Row>> | undefined
    let writable: WritableStream<Row> | undefined
    // 47.38 — READ ON THE CONNECTION AS IT IS: a database refusing the change log is still read.
    const read = selects<Row>(acquire, name)
    const writes = rowWrites<Row>(name, key)
    // 47.29, 47.34 — a write made here is heard at once: what read the table is refreshed now, and
    // the watch's next look does not hear it again. 47.43 — save inside a transaction, whose commit
    // the watch's next look hears, and whose rollback it never does.
    const wrote = (db: Database, count: number): number => {
        if (count === 0) return count
        const watch = watchOf(database, connection, name)
        if (!db.inTransaction || watch.broken) heard(watch, connection)
        return count
    }
    const keyed = (db: Database, rows: readonly Partial<Row>[]): void => {
        const columns = keyColumns(describe(db, name), key)
        for (const row of rows)
            for (const column of columns) keyOf(name, column, row)
    }
    const set = (rows: Row | readonly Row[]): void => {
        const each = listOf(rows)
        const db = connection()
        keyed(db, each)
        writes.upsert(db, each)
        wrote(db, each.length)
    }
    const patch = (rows: Partial<Row> | readonly Partial<Row>[]): void => {
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
                `abide: a delete from table ${name} names no column, which would delete every row. RULEBOOK 47.33.`,
            )
        const db = connection()
        return wrote(db, read.remove(db, match))
    }
    const called = (match?: Match<Row>): Row[] => {
        const rows = read.rows(match)
        readBy(watchOf(database, connection, name))
        return rows
    }
    const peek = (match?: Match<Row>): Row[] => read.rows(match)
    const insert = (rows: Row | readonly Row[]): Row[] => {
        const each = listOf(rows)
        const db = connection()
        const stored = writes.insert(db, each)
        wrote(db, stored.length)
        return stored
    }
    return Object.defineProperties(called, {
        // 16.117 — read by `rpc` for its face.
        [SOURCE_KIND]: { value: { kind: 'table', name } },
        peek: { value: peek },
        insert: { value: insert },
        set: { value: set },
        patch: { value: patch },
        delete: { value: remove },
        // 47.25 — reached, the table is prepared, and a table the database does not hold throws here.
        readable: {
            get() {
                connection()
                readable ??= changesOf<Row>(connection, name)
                return readable
            },
        },
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
 * 47.39 — a table as its database describes it: its columns, the codec each declared type names, and
 * its primary key's columns in key order.
 */
type Description = {
    columns: Set<string>
    coded: CodedColumn[]
    codecs: Map<string, ColumnCodec>
    primaryKey: string[]
}

/** 47.39 — each `Database`'s tables, described the first time each is reached through it. */
const DESCRIBED = new WeakMap<Database, Map<string, Description>>()

/** 47.39 — `name` as `db` holds it; 47.25 — a table it does not hold is refused. */
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
            `abide: table ${name} is not in the database. RULEBOOK 47.25.`,
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
 * 47.30 — the columns a write names its row by: `key` where given, the table's primary key where it
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
 * 47.42 — per table name, the columns its changes carry: the union of every `logged` asked for in this
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

/** `acquire`'s `Database`, with `name`'s change log and triggers made on it (47.26). */
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

/** 47.36 — the comparisons a `ColumnMatch` object may name, each to the operator it is. */
const COMPARISONS: Record<string, string> = {
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    ne: 'IS NOT',
    like: 'LIKE',
}

/**
 * 47.35, 47.36 — the rows of `name`, or those every column `match` names matches: one statement per
 * shape of match — its columns, the slots of each list and the comparisons named — each column
 * checked against the table's own; and 47.33 — the rows a match names deleted, by the same shapes.
 * 47.40 — the rows read with their coded columns decoded.
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
                        `abide: table ${name} has no column ${JSON.stringify(column)}. RULEBOOK 47.35.`,
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

/** 47.33 — the key `row` carries, which a write by key cannot go without. */
function keyOf(name: string, key: string, row: unknown): unknown {
    const id = (row as Record<string, unknown> | null)?.[key]
    if (id === undefined || id === null)
        throw new Error(
            `abide: a row written to table ${name} carries no ${key}. RULEBOOK 47.33.`,
        )
    return id
}

/**
 * 47.35, 47.36 — the condition `value` puts on `column`, its values pushed onto `values`, encoded as
 * the column's declared type says (47.41). NULL-SAFE as JSON is: a list holding `null` matches a
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
                    `abide: table ${name}'s match on ${column} holds ${reason}. RULEBOOK 47.36.`,
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
                `abide: table ${name}'s match on ${column} names ${JSON.stringify(comparison)}, which is none of gt, gte, lt, lte, ne, like. RULEBOOK 47.36.`,
            )
        const bound = value[comparison]
        if (bound === undefined) continue
        if (bound === null) {
            if (comparison !== 'ne')
                throw new Error(
                    `abide: table ${name}'s match on ${column} compares ${comparison} to null, which orders nothing. RULEBOOK 47.36.`,
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
 * as its column's declared type says (47.41).
 */
function scalarOf(
    name: string,
    column: string,
    codec: ColumnCodec | undefined,
    value: unknown,
): unknown {
    if (Array.isArray(value) || isPlainObject(value))
        throw new Error(
            `abide: table ${name}'s match on ${column} nests a list or an object where a value goes. RULEBOOK 47.36.`,
        )
    return codec === undefined ? value : encoded(codec, value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !Array.isArray(value) && isPlainData(value)
}

/** Where each `Database` has had its change log made, and each table its triggers, as logged. */
const PREPARED = new WeakMap<Database, Map<string, string>>()

/**
 * 47.25, 47.26 — the change log, and the table's triggers naming every column it has now, or the
 * columns 47.42 logs and its key: made again the first time each `Database` reaches the table, so a
 * column a migration added is captured, and again where this process asks to log more.
 */
function prepare(db: Database, name: string, key: string | undefined): void {
    let tables = PREPARED.get(db)
    if (tables === undefined) {
        db.run(
            'CREATE TABLE IF NOT EXISTS abide_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, op TEXT NOT NULL, row TEXT, previous TEXT)',
        )
        db.run(
            'CREATE INDEX IF NOT EXISTS abide_changes_tbl ON abide_changes (tbl, seq)',
        )
        // 47.44 — how far another process has removed a table's changes, which a reader behind it
        // cannot read past.
        db.run(
            'CREATE TABLE IF NOT EXISTS abide_changes_removed (tbl TEXT PRIMARY KEY, through INTEGER NOT NULL)',
        )
        tables = new Map()
        PREPARED.set(db, tables)
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
                    `abide: table ${name} has no column ${JSON.stringify(column)} to log. RULEBOOK 47.42.`,
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
    const triggers: [string, string, string, string][] = [
        ['insert', 'INSERT', objectOf('NEW'), 'NULL'],
        ['update', 'UPDATE', objectOf('NEW'), objectOf('OLD')],
        ['delete', 'DELETE', 'NULL', objectOf('OLD')],
    ]
    db.transaction(() => {
        for (const [op, event, row, previous] of triggers) {
            db.run(`DROP TRIGGER IF EXISTS abide_changes_${name}_${op}`)
            db.run(
                `CREATE TRIGGER abide_changes_${name}_${op} AFTER ${event} ON ${name} BEGIN INSERT INTO abide_changes (tbl, op, row, previous) VALUES ('${name}', '${op}', ${row}, ${previous}); END`,
            )
        }
    })()
    tables.set(name, signature)
}

function lastChange(db: Database, name: string): number {
    const found = db
        .query('SELECT MAX(seq) AS last FROM abide_changes WHERE tbl = ?')
        .get(name) as { last: number | null }
    return found.last ?? 0
}

/** Calls `look` every `LOOK_EVERY` ms until the app stops or `stopped` says so. */
function looking(
    look: () => void,
    stopped: () => boolean,
    ended?: () => void,
): void {
    const stopping = appStopSignal()
    const timer = setInterval(() => {
        if (stopped() || stopping.aborted) {
            clearInterval(timer)
            ended?.()
            return
        }
        look()
    }, LOOK_EVERY)
    unrefTimer(timer)
}

/**
 * 47.29 — one table's watch: its name, the last change it has passed, the runs whose last run called
 * the table, and whether it has stopped (47.38). A reader is held by its record, which holds its value
 * weakly — a read is never a reason to keep one.
 */
type Watch = {
    name: string
    seen: number | undefined
    readers: Set<Reader>
    broken: boolean
}

/** One run's calls of tables: the value whose run it is, which run, and the tables it called. */
type Reader = { value: WeakRef<Cell>; epoch: number; tables: Set<Watch> }

/** 47.29 — each value's reads, as of its last run that called a table. */
const READERS = new WeakMap<Cell, Reader>()

/** 47.29 — per database or opener, each table's watch. */
const WATCHED = new WeakMap<object, Map<string, Watch>>()

/** 47.38 — the databases whose stopped watch has been said. */
const WARNED = new WeakSet<object>()

/**
 * 47.31 — per table name, how far each `readable` open in this process has read, which the watch
 * keeps the log for.
 */
const READING = new Map<string, Set<{ position: number | undefined }>>()

/** 47.31 — the change before the first one an open `readable` of `name` has still to read. */
function keptFor(name: string): number {
    let least = Number.POSITIVE_INFINITY
    for (const reading of READING.get(name) ?? [])
        if (reading.position !== undefined && reading.position < least)
            least = reading.position
    return least
}

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
    if (standing !== undefined) return standing
    // 47.29 — the baseline taken where the table is named, so a write before the first look is heard.
    const watch: Watch = {
        name,
        seen: undefined,
        readers: new Set(),
        broken: false,
    }
    watches.set(name, watch)
    const watched = watches
    try {
        watch.seen = lastChange(connection(), name)
    } catch {}
    looking(
        () => {
            let db: Database
            try {
                db = connection()
            } catch (thrown) {
                // 47.38 — a database refusing the change log, read-only among them: said once per
                // database, and the writes made through its `table` are then all that refresh.
                watch.broken = true
                if (!WARNED.has(owner)) {
                    WARNED.add(owner)
                    WATCH_LOG.warning(
                        `the watch of ${name} stopped: only writes made through its table refresh what read it. RULEBOOK 47.38.`,
                        thrown,
                    )
                }
                return
            }
            const last = lastChange(db, name)
            if (watch.seen === undefined) {
                watch.seen = last
                return
            }
            if (last === watch.seen) return
            watch.seen = last
            changed(watch)
            // 47.31 — the last changes kept, and every one a reader here has still to read.
            const through = Math.min(last - CHANGES_KEPT, keptFor(name))
            if (through > 0) {
                const removed = db
                    .query(
                        'DELETE FROM abide_changes WHERE tbl = ? AND seq <= ?',
                    )
                    .run(name, through)
                if (removed.changes > 0)
                    db.query(
                        'INSERT INTO abide_changes_removed (tbl, through) VALUES (?1, ?2) ON CONFLICT (tbl) DO UPDATE SET through = MAX(through, ?2)',
                    ).run(name, through)
            }
        },
        () => watch.broken,
        // The app stopped: the next `table` call for this name watches again.
        () => watched.delete(name),
    )
    return watch
}

/**
 * 47.29 — what a change to the watched table refreshes: the values whose last run called it, reloaded
 * where something reads them (13.7) and kept until then, so a reader never meets one empty.
 */
function changed(watch: Watch): void {
    const reloading: Cell[] = []
    for (const reader of watch.readers) {
        const cell = reader.value.deref()
        // Collected, or run again since without calling the table: its last run did not read it.
        if (cell === undefined || cell.runEpoch !== reader.epoch) {
            watch.readers.delete(reader)
            continue
        }
        reloading.push(cell)
    }
    if (reloading.length > 0) refreshCells(reloading)
}

/**
 * 47.29 — the run this is called in called the table: a change to it refreshes that run's value. Not
 * a mutation's run (13.16), nor the continuation of a run already ended (7.24).
 */
function readBy(watch: Watch): void {
    const mark = SCOPING.provider?.currentRun()
    if (mark === undefined) return
    const cell = mark.cell
    if (cell.mutation || mark.epoch !== cell.runEpoch) return
    let reader = READERS.get(cell)
    if (reader === undefined || reader.epoch !== mark.epoch) {
        // A new run: what the last one called is not what this one calls.
        if (reader !== undefined)
            for (const called of reader.tables) called.readers.delete(reader)
        reader = {
            value: new WeakRef(cell),
            epoch: mark.epoch,
            tables: new Set(),
        }
        READERS.set(cell, reader)
    }
    reader.tables.add(watch)
    watch.readers.add(reader)
}

/** 47.34 — a write made here, heard now, so the watch's next look does not hear it again. */
function heard(watch: Watch, connection: () => Database): void {
    try {
        watch.seen = lastChange(connection(), watch.name)
    } catch {}
    changed(watch)
}

/**
 * 47.27, 47.28 — the table's changes from the moment the stream is first read, in order, their coded
 * columns decoded (47.40); 47.44 — and an error where another process removed one it had still to
 * read.
 */
function changesOf<Row>(
    connection: () => Database,
    name: string,
): ReadableStream<Change<Row>> {
    const reading: { position: number | undefined } = { position: undefined }
    let cancelled = false
    let wake: (() => void) | undefined
    const pending: Change<Row>[] = []
    const rowOf = (
        text: string | null,
        coded: CodedColumn[],
    ): Row | undefined =>
        text === null
            ? undefined
            : (decodeRows([JSON.parse(text) as Row], coded)[0] as Row)
    const read = (): void => {
        const db = connection()
        if (reading.position === undefined) {
            reading.position = lastChange(db, name)
            let readers = READING.get(name)
            if (readers === undefined) {
                readers = new Set()
                READING.set(name, readers)
            }
            readers.add(reading)
        }
        const removed = db
            .query('SELECT through FROM abide_changes_removed WHERE tbl = ?')
            .get(name) as { through: number } | null
        if (removed !== null && removed.through > reading.position)
            throw new Error(
                `abide: table ${name}'s changes up to ${removed.through} were removed before this reader, at ${reading.position}, read them; read the table again. RULEBOOK 47.44.`,
            )
        const { coded } = describe(db, name)
        const rows = db
            .query(
                'SELECT seq, op, row, previous FROM abide_changes WHERE tbl = ? AND seq > ? ORDER BY seq LIMIT 256',
            )
            .all(name, reading.position) as {
            seq: number
            op: Change<Row>['op']
            row: string | null
            previous: string | null
        }[]
        for (const change of rows) {
            reading.position = change.seq
            pending.push({
                op: change.op,
                row: rowOf(change.row, coded),
                previous: rowOf(change.previous, coded),
            })
        }
    }
    const done = (): void => {
        cancelled = true
        READING.get(name)?.delete(reading)
        if (wake !== undefined) wake()
    }
    return new ReadableStream<Change<Row>>(
        {
            start: () => {
                read()
                looking(
                    () => {
                        if (wake !== undefined) wake()
                    },
                    () => cancelled,
                )
            },
            pull: async (controller) => {
                for (;;) {
                    if (cancelled) return
                    if (pending.length === 0)
                        try {
                            read()
                        } catch (thrown) {
                            done()
                            controller.error(thrown)
                            return
                        }
                    const next = pending.shift()
                    if (next !== undefined) {
                        controller.enqueue(next)
                        return
                    }
                    await new Promise<void>((woke) => {
                        wake = () => {
                            wake = undefined
                            woke()
                        }
                    })
                }
            },
            cancel: done,
        },
        { highWaterMark: 0 },
    )
}

/**
 * 47.30, 47.33 — rows upserted by their key, or the columns they name updated on the row with their
 * key, each batch one transaction. One statement per shape of row, its columns checked and its SQL
 * written once: a batch of rows with the same columns runs one prepared statement. 47.41 — each value
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
        // 47.33 — a column whose value is `undefined` is not named, as JSON leaves it out.
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
    /** Each row's statement run with its values, encoded per 47.41, in one transaction. */
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

/** How many of `row`'s columns hold a value: `undefined` is no value (47.33). */
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

/** 47.30 — rows upserted by their key, a turn's writes one transaction. */
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
            // 47.30 — a full batch waits for its commit, so a writer faster than the table is held.
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
