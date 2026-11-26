// 47.25-47.31 — A TABLE AS A STREAM PAIR: its changes read out, and rows written in.
//
// THE CHANGES ARE CAPTURED IN THE WRITER'S TRANSACTION. Triggers on the table append each insert,
// update and delete to `abide_changes` as part of the statement that made it, so whoever wrote the
// row — this pair, an ORM, raw SQL, another process — a committed write is one change and a rolled
// back one is none. bun:sqlite has no update hook, so the changes are read by a look at the log's
// last number, which is an index read; a look that finds nothing new costs that alone.
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

/** Where each `Database` has had its change log made, and each table its triggers. */
const PREPARED = new WeakMap<Database, Set<string>>()

export type { ColumnMatch, Match } from '#shared/Match.ts'

/**
 * A table of the app's database: its rows read by calling it, rows written by key, its changes read
 * out and rows streamed in.
 */
export type Table<Row> = ((match?: Match<Row>) => Row[]) & {
    /** 47.33 — rows upserted by key: inserted, or replacing the row with their key. */
    set(rows: Row | readonly Row[]): void
    /** 47.33 — the columns each row names written onto the row with its key; the rest are left. */
    patch(rows: Partial<Row> | readonly Partial<Row>[]): void
    /** 47.33 — the rows `match` names deleted, and how many there were. */
    delete(match: Match<Row>): number
    readonly readable: ReadableStream<Change<Row>>
    readonly writable: WritableStream<Row>
}

/**
 * A table of `database`: called, its rows, or those `match` names (47.35), a read that refreshes the
 * run it is made in when the table changes (47.29); `readable` its changes from the moment it is first
 * read, `writable` the rows to upsert by `key` (47.25-47.31).
 */
export function table<Row extends Record<string, unknown>>(
    database: Database | (() => Database),
    name: string,
    options?: { key?: (keyof Row & string) | undefined },
): Table<Row> {
    if (!SQL_IDENTIFIER.test(name))
        throw new Error(
            `abide: table ${JSON.stringify(name)} is not an SQL identifier.`,
        )
    const key = options?.key ?? 'id'
    if (!SQL_IDENTIFIER.test(key))
        throw new Error(
            `abide: table ${name}'s key ${JSON.stringify(key)} is not an SQL identifier.`,
        )
    const acquire = typeof database === 'function' ? database : () => database
    const connection = preparedConnection(acquire, name)
    watchOf(database, connection, name)
    let readable: ReadableStream<Change<Row>> | undefined
    let writable: WritableStream<Row> | undefined
    // 47.38 — READ ON THE CONNECTION AS IT IS: a database refusing the change log is still read.
    const read = selects<Row>(acquire, name)
    const writes = rowWrites<Row>(name, key)
    // 47.29, 47.34 — a write made here is heard at once: what read the table is refreshed now, and
    // the watch's next look does not hear it again.
    const wrote = (count: number): number => {
        if (count > 0) heard(watchOf(database, connection, name), connection)
        return count
    }
    const set = (rows: Row | readonly Row[]): void => {
        const each = listOf(rows)
        for (const row of each) keyOf(name, key, row)
        writes.upsert(connection(), each)
        wrote(each.length)
    }
    const patch = (rows: Partial<Row> | readonly Partial<Row>[]): void => {
        const each = listOf(rows)
        for (const row of each) keyOf(name, key, row)
        writes.update(connection(), each)
        wrote(each.length)
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
        return wrote(read.remove(connection(), match))
    }
    const called = (match?: Match<Row>): Row[] => {
        const rows = read.rows(match)
        readBy(watchOf(database, connection, name))
        return rows
    }
    return Object.defineProperties(called, {
        // 16.117 — read by `rpc` for its face.
        [SOURCE_KIND]: { value: { kind: 'table', name } },
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
                writable ??= upserts<Row>(connection, name, key)
                return writable
            },
        },
    }) as Table<Row>
}

/** `acquire`'s `Database`, with `name`'s change log and triggers made on it (47.26). */
function preparedConnection(
    acquire: () => Database,
    name: string,
): () => Database {
    return () => {
        const db = acquire()
        prepare(db, name)
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
}

/**
 * 47.35, 47.36 — the rows of `name`, or those every column `match` names matches: one statement per
 * shape of match — its columns, the length of each list and the comparisons named — each column
 * checked against the table's own; and 47.33 — the rows a match names deleted, by the same shapes.
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
    let columns: Set<string> | undefined
    const shaped = (
        db: Database,
        match: Match<Row> | undefined,
        verb: 'SELECT *' | 'DELETE',
    ): [ReturnType<Database['query']>, unknown[]] => {
        if (db !== preparedOn) {
            statements.clear()
            preparedOn = db
            columns = new Set()
            const found = db.query(`PRAGMA table_info(${name})`).all() as {
                name: string
            }[]
            if (found.length === 0) {
                preparedOn = undefined
                throw new Error(
                    `abide: table ${name} is not in the database. RULEBOOK 47.25.`,
                )
            }
            for (const column of found)
                if (SQL_IDENTIFIER.test(column.name)) columns.add(column.name)
        }
        const values: unknown[] = []
        const conditions: string[] = []
        if (match !== undefined)
            for (const column in match) {
                const value: unknown = match[column as keyof Row]
                if (value === undefined) continue
                if (!(columns as Set<string>).has(column))
                    throw new Error(
                        `abide: table ${name} has no column ${JSON.stringify(column)}. RULEBOOK 47.35.`,
                    )
                conditions.push(conditionOf(name, column, value, values))
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
            const [statement, values] = shaped(acquire(), match, 'SELECT *')
            return statement.all(...(values as never[])) as Row[]
        },
        remove: (db, match) => {
            const [statement, values] = shaped(db, match, 'DELETE')
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
 * 47.35, 47.36 — the condition `value` puts on `column`, its values pushed onto `values`. NULL-SAFE as
 * JSON is: a list holding `null` matches a NULL, and `ne` is `IS NOT`, so a NULL is not a value
 * `ne: 'won'` refuses. An empty list is no value at all and matches no row.
 */
function conditionOf(
    name: string,
    column: string,
    value: unknown,
    values: unknown[],
): string {
    const quoted = `"${column}"`
    if (value === null) return `${quoted} IS NULL`
    if (Array.isArray(value)) {
        const slots: string[] = []
        let nullable = false
        for (const each of value as unknown[]) {
            if (each === null) nullable = true
            else {
                slots.push('?')
                values.push(scalarOf(name, column, each))
            }
        }
        const listed =
            slots.length === 0 ? '' : `${quoted} IN (${slots.join(', ')})`
        if (nullable)
            return listed === ''
                ? `${quoted} IS NULL`
                : `(${listed} OR ${quoted} IS NULL)`
        return listed === '' ? '0' : listed
    }
    if (!isPlainObject(value)) return pushed(`${quoted} = ?`, values, value)
    const met: string[] = []
    for (const comparison in value) {
        const operator = COMPARISONS[comparison]
        if (operator === undefined)
            throw new Error(
                `abide: table ${name}'s match on ${column} names ${JSON.stringify(comparison)}, which is none of gt, gte, lt, lte, ne. RULEBOOK 47.36.`,
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
                scalarOf(name, column, bound),
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

/** A value a list or a comparison holds, which is one value: no list or object nested in it. */
function scalarOf(name: string, column: string, value: unknown): unknown {
    if (Array.isArray(value) || isPlainObject(value))
        throw new Error(
            `abide: table ${name}'s match on ${column} nests a list or an object where a value goes. RULEBOOK 47.36.`,
        )
    return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !Array.isArray(value) && isPlainData(value)
}

/**
 * 47.25, 47.26 — the change log, and the table's triggers naming every column it has now: made again
 * the first time each `Database` reaches the table, so a column a migration added is captured.
 */
function prepare(db: Database, name: string): void {
    let tables = PREPARED.get(db)
    if (tables === undefined) {
        db.run(
            'CREATE TABLE IF NOT EXISTS abide_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, op TEXT NOT NULL, row TEXT, previous TEXT)',
        )
        db.run(
            'CREATE INDEX IF NOT EXISTS abide_changes_tbl ON abide_changes (tbl, seq)',
        )
        tables = new Set()
        PREPARED.set(db, tables)
    }
    if (tables.has(name)) return
    const columns = db.query(`PRAGMA table_info(${name})`).all() as {
        name: string
    }[]
    if (columns.length === 0)
        throw new Error(
            `abide: table ${name} is not in the database. RULEBOOK 47.25.`,
        )
    const objectOf = (side: 'NEW' | 'OLD'): string => {
        const pairs: string[] = []
        for (const column of columns)
            pairs.push(`'${column.name}', ${side}."${column.name}"`)
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
    tables.add(name)
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
 * 47.29 — one table's watch: its name, the last change it has passed, and the runs whose last run
 * called the table. A reader is held by its record, which holds its value weakly — a read is never a
 * reason to keep one.
 */
type Watch = { name: string; seen: number | undefined; readers: Set<Reader> }

/** One run's calls of tables: the value whose run it is, which run, and the tables it called. */
type Reader = { value: WeakRef<Cell>; epoch: number; tables: Set<Watch> }

/** 47.29 — each value's reads, as of its last run that called a table. */
const READERS = new WeakMap<Cell, Reader>()

/** 47.29 — per database or opener, each table's watch. */
const WATCHED = new WeakMap<object, Map<string, Watch>>()

/** 47.38 — the databases whose stopped watch has been said. */
const WARNED = new WeakSet<object>()

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
    const watch: Watch = { name, seen: undefined, readers: new Set() }
    watches.set(name, watch)
    const watched = watches
    try {
        watch.seen = lastChange(connection(), name)
    } catch {}
    let broken = false
    looking(
        () => {
            let db: Database
            try {
                db = connection()
            } catch (thrown) {
                // 47.38 — a database refusing the change log, read-only among them: said once per
                // database, and the writes made through its `table` are then all that refresh.
                broken = true
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
            if (last > CHANGES_KEPT)
                db.query(
                    'DELETE FROM abide_changes WHERE tbl = ? AND seq <= ?',
                ).run(name, last - CHANGES_KEPT)
        },
        () => broken,
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

/** 47.27, 47.28 — the table's changes from the moment the stream is first read, in order. */
function changesOf<Row>(
    connection: () => Database,
    name: string,
): ReadableStream<Change<Row>> {
    let position: number | undefined
    let cancelled = false
    let wake: (() => void) | undefined
    const pending: Change<Row>[] = []
    const read = (): void => {
        const db = connection()
        position ??= lastChange(db, name)
        const rows = db
            .query(
                'SELECT seq, op, row, previous FROM abide_changes WHERE tbl = ? AND seq > ? ORDER BY seq LIMIT 256',
            )
            .all(name, position) as {
            seq: number
            op: Change<Row>['op']
            row: string | null
            previous: string | null
        }[]
        for (const change of rows) {
            position = change.seq
            pending.push({
                op: change.op,
                row:
                    change.row === null
                        ? undefined
                        : (JSON.parse(change.row) as Row),
                previous:
                    change.previous === null
                        ? undefined
                        : (JSON.parse(change.previous) as Row),
            })
        }
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
                    if (pending.length === 0) read()
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
            cancel: () => {
                cancelled = true
                if (wake !== undefined) wake()
            },
        },
        { highWaterMark: 0 },
    )
}

/**
 * 47.30, 47.33 — rows upserted by `key`, or the columns they name updated on the row with their key,
 * each batch one transaction. One statement per shape of row, its columns checked and its SQL written
 * once: a batch of rows with the same columns runs one prepared statement.
 */
function rowWrites<Row extends Record<string, unknown>>(
    name: string,
    key: string,
): {
    upsert: (db: Database, rows: readonly Row[]) => void
    update: (db: Database, rows: readonly Partial<Row>[]) => void
} {
    const statements = new Map<
        string,
        { columns: string[]; statement: ReturnType<Database['query']> }
    >()
    // A statement is its database's: a `connection` handing back another starts the map over.
    let preparedOn: Database | undefined
    const statementFor = (
        db: Database,
        row: Partial<Row>,
        updating: boolean,
    ) => {
        if (db !== preparedOn) {
            statements.clear()
            preparedOn = db
        }
        const columns = Object.keys(row)
        const shape = `${updating ? 'u' : 'i'}:${columns.join(',')}`
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
            const quoted: string[] = []
            const slots: string[] = []
            const updates: string[] = []
            const sets: string[] = []
            for (const column of columns) {
                quoted.push(`"${column}"`)
                slots.push('?')
                if (column === key) continue
                updates.push(`"${column}" = excluded."${column}"`)
                sets.push(`"${column}" = ?`)
            }
            const conflict =
                updates.length === 0
                    ? 'DO NOTHING'
                    : `DO UPDATE SET ${updates.join(', ')}`
            // An update binds the columns it sets, then the key it names the row by.
            const ordered = updating
                ? [...columns.filter((column) => column !== key), key]
                : columns
            prepared = {
                columns: ordered,
                statement: db.query(
                    updating
                        ? `UPDATE ${name} SET ${sets.join(', ')} WHERE "${key}" = ?`
                        : `INSERT INTO ${name} (${quoted.join(', ')}) VALUES (${slots.join(', ')}) ON CONFLICT("${key}") ${conflict}`,
                ),
            }
            statements.set(shape, prepared)
        }
        return prepared
    }
    const written =
        (updating: boolean) =>
        (db: Database, rows: readonly Partial<Row>[]): void => {
            db.transaction(() => {
                for (const row of rows) {
                    // An update naming no column but its key changes nothing.
                    if (updating && Object.keys(row).length < 2) continue
                    const { columns, statement } = statementFor(
                        db,
                        row,
                        updating,
                    )
                    const values = new Array<unknown>(columns.length)
                    for (let at = 0; at < columns.length; at += 1)
                        values[at] = row[columns[at] as string]
                    statement.run(...(values as never[]))
                }
            })()
        }
    return { upsert: written(false), update: written(true) }
}

/** 47.30 — rows upserted by `key`, a turn's writes one transaction. */
function upserts<Row extends Record<string, unknown>>(
    connection: () => Database,
    name: string,
    key: string,
): WritableStream<Row> {
    let buffered: Row[] = []
    let flushing: Promise<void> | undefined
    let failed: unknown
    let timer: ReturnType<typeof setTimeout> | undefined
    const writes = rowWrites<Row>(name, key)
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
