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

import { namedLogger } from '#shared/log.ts'
import { appStopSignal } from '#shared/reactive/abortSignal.ts'
import type { Cell } from '#shared/reactive/cellShape.ts'
import { invalidate } from '#shared/reactive/index.ts'
import { refreshCells } from '#shared/reactive/producer.ts'
import { SCOPING } from '#shared/reactive/scoping.ts'
import { unrefTimer } from '#shared/reactive/unrefTimer.ts'

import { SQL_IDENTIFIER } from './SQL_IDENTIFIER.ts'

const WATCH_LOG = namedLogger('abide:table')

/** 47.27 — how often a reader or the tag's watch looks for changes past the last it saw. */
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

/** A table of the app's database: its rows read by calling it, its changes read out, rows written in. */
export type Table<Row> = ((match?: Partial<Row>) => Row[]) & {
    readonly readable: ReadableStream<Change<Row>>
    readonly writable: WritableStream<Row>
}

/**
 * A table of `database`: called, its rows, or those `match` names (47.35), a read that refreshes the
 * run it is made in when the table changes (47.32); `readable` its changes from the moment it is first
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
    const names = [name]
    const rows = selects<Row>(connection, name)
    const read = (match?: Partial<Row>): Row[] => {
        const answered = rows(match)
        readTables(database, connection, names)
        return answered
    }
    return Object.defineProperties(read, {
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
export function preparedConnection(
    acquire: () => Database,
    name: string,
): () => Database {
    return () => {
        const db = acquire()
        prepare(db, name)
        return db
    }
}

/**
 * 47.35 — the rows of `name`, or those whose every column `match` names equals what it gives: one
 * statement per set of columns matched, each column checked against the table's own.
 */
function selects<Row>(
    connection: () => Database,
    name: string,
): (match?: Partial<Row>) => Row[] {
    const statements = new Map<string, ReturnType<Database['query']>>()
    let preparedOn: Database | undefined
    let columns: Set<string> | undefined
    return (match) => {
        const db = connection()
        if (db !== preparedOn) {
            statements.clear()
            preparedOn = db
            columns = new Set()
            for (const column of db
                .query(`PRAGMA table_info(${name})`)
                .all() as { name: string }[])
                if (SQL_IDENTIFIER.test(column.name)) columns.add(column.name)
        }
        const values: unknown[] = []
        const conditions: string[] = []
        if (match !== undefined)
            for (const column in match) {
                const value = match[column as keyof Row]
                if (value === undefined) continue
                if (!(columns as Set<string>).has(column))
                    throw new Error(
                        `abide: table ${name} has no column ${JSON.stringify(column)}. RULEBOOK 47.35.`,
                    )
                if (value === null) conditions.push(`"${column}" IS NULL`)
                else {
                    conditions.push(`"${column}" = ?`)
                    values.push(value)
                }
            }
        const shape = conditions.join(' AND ')
        let statement = statements.get(shape)
        if (statement === undefined) {
            statement = db.query(
                shape === ''
                    ? `SELECT * FROM ${name}`
                    : `SELECT * FROM ${name} WHERE ${shape}`,
            )
            statements.set(shape, statement)
        }
        return statement.all(...(values as never[])) as Row[]
    }
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
 * 47.29, 47.32 — one table's watch: the last change it has passed, and the runs that read the table.
 * A reader is held by its record, which holds its value weakly — a read is never a reason to keep one.
 */
type Watch = { name: string; seen: number | undefined; readers: Set<Reader> }

/** One run's reads: the value whose run it is, which run, and the watches of the tables it read. */
type Reader = {
    value: WeakRef<Cell>
    epoch: number
    tables: Set<Watch>
    wrote: Set<Watch>
}

/** 47.29 — per database or opener, each table's watch. */
const WATCHED = new WeakMap<object, Map<string, Watch>>()

/** 47.32 — each value's reads, as of its last run that read a table. */
const READERS = new WeakMap<Cell, Reader>()

/** 47.29, 47.31 — each change to `name` refreshes every value tagged `name`, and old changes go. */
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
                // 47.25 — said once by the watch, and thrown by every read and write of the table.
                broken = true
                WATCH_LOG.warning(`the watch of ${name} stopped`, thrown)
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

/** 47.29, 47.32 — what a change to the watched table refreshes: its tag, and the runs that read it. */
function changed(watch: Watch): void {
    invalidate({ tags: [watch.name] })
    const reloading: Cell[] = []
    for (const reader of watch.readers) {
        const cell = reader.value.deref()
        // Collected, or run again since without reading the table: its last run did not read it.
        if (cell === undefined || cell.runEpoch !== reader.epoch) {
            watch.readers.delete(reader)
            continue
        }
        reloading.push(cell)
    }
    if (reloading.length > 0) refreshCells(reloading)
}

/**
 * 47.32, 47.33 — the run this is called in, where one is running that a table's change may refresh:
 * not a mutation's (13.16), nor the continuation of a run already ended (7.24).
 */
function runReading(): Reader | undefined {
    const mark = SCOPING.provider?.currentRun()
    if (mark === undefined) return undefined
    const cell = mark.cell
    if (cell.mutation || mark.epoch !== cell.runEpoch) return undefined
    let reader = READERS.get(cell)
    if (reader !== undefined && reader.epoch === mark.epoch) return reader
    // A new run: what the last one read is not what this one reads.
    if (reader !== undefined)
        for (const watch of reader.tables) watch.readers.delete(reader)
    reader = {
        value: new WeakRef(cell),
        epoch: mark.epoch,
        tables: new Set(),
        wrote: new Set(),
    }
    READERS.set(cell, reader)
    return reader
}

/** 47.32 — the run this is called in read `names`: a change to any of them refreshes it. */
export function readTables(
    owner: object,
    connection: () => Database,
    names: readonly string[],
): void {
    if (names.length === 0) return
    const reader = runReading()
    if (reader === undefined) return
    for (const name of names) {
        const watch = watchOf(owner, connection, name)
        if (reader.tables.has(watch) || reader.wrote.has(watch)) continue
        reader.tables.add(watch)
        watch.readers.add(reader)
    }
}

/** 47.33, 47.34 — the tables written in this turn through `sql`, refreshed once each as it ends. */
const WRITTEN = new Set<Watch>()
let flushing: (() => void) | undefined

/**
 * 47.33 — the run this is called in wrote `names`: it is no reader of them, and 47.34 refreshes what
 * read them as the turn ends.
 */
export function wroteTables(
    owner: object,
    connection: () => Database,
    names: readonly string[],
): void {
    if (names.length === 0) return
    const reader = runReading()
    for (const name of names) {
        const watch = watchOf(owner, connection, name)
        if (reader !== undefined) {
            reader.wrote.add(watch)
            reader.tables.delete(watch)
            watch.readers.delete(reader)
        }
        WRITTEN.add(watch)
        WROTE_ON.set(watch, connection)
    }
    if (flushing !== undefined) return
    flushing = () => {
        flushing = undefined
        const watches = [...WRITTEN]
        WRITTEN.clear()
        for (const watch of watches) {
            // 47.34 — heard here, so the watch's next look does not hear it again.
            try {
                watch.seen = lastChange(
                    (WROTE_ON.get(watch) as () => Database)(),
                    watch.name,
                )
            } catch {}
            changed(watch)
        }
    }
    setTimeout(flushing, 0)
}

/** The connection each written watch's write was made on, to read its log's last change from. */
const WROTE_ON = new WeakMap<Watch, () => Database>()

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
    // One statement per shape of row, its columns checked and its SQL written once: a batch of rows
    // with the same columns runs one prepared statement.
    const statements = new Map<
        string,
        { columns: string[]; statement: ReturnType<Database['query']> }
    >()
    // A statement is its database's: a `connection` handing back another starts the map over.
    let preparedOn: Database | undefined
    const statementFor = (db: Database, row: Row) => {
        if (db !== preparedOn) {
            statements.clear()
            preparedOn = db
        }
        const columns = Object.keys(row)
        const shape = columns.join(',')
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
            for (const column of columns) {
                quoted.push(`"${column}"`)
                slots.push('?')
                if (column !== key)
                    updates.push(`"${column}" = excluded."${column}"`)
            }
            const conflict =
                updates.length === 0
                    ? 'DO NOTHING'
                    : `DO UPDATE SET ${updates.join(', ')}`
            prepared = {
                columns,
                statement: db.query(
                    `INSERT INTO ${name} (${quoted.join(', ')}) VALUES (${slots.join(', ')}) ON CONFLICT("${key}") ${conflict}`,
                ),
            }
            statements.set(shape, prepared)
        }
        return prepared
    }
    const commit = (rows: Row[]): void => {
        const db = connection()
        db.transaction(() => {
            for (const row of rows) {
                const { columns, statement } = statementFor(db, row)
                const values = new Array<unknown>(columns.length)
                for (let at = 0; at < columns.length; at += 1)
                    values[at] = row[columns[at] as string]
                statement.run(...(values as never[]))
            }
        })()
    }
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
