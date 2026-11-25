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
import { invalidate } from '#shared/reactive/index.ts'
import { appStopSignal } from '#shared/reactive/poll.ts'
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

/**
 * A table of `database` as a stream pair: `readable` its changes from the moment it is first read,
 * `writable` the rows to upsert by `key` (47.25-47.31).
 */
export function table<Row extends Record<string, unknown>>(
    database: Database | (() => Database),
    name: string,
    options?: { key?: (keyof Row & string) | undefined },
): { readable: ReadableStream<Change<Row>>; writable: WritableStream<Row> } {
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
    const connection = (): Database => {
        const db = acquire()
        prepare(db, name)
        return db
    }
    watchTag(database, connection, name)
    let readable: ReadableStream<Change<Row>> | undefined
    let writable: WritableStream<Row> | undefined
    return {
        // 47.25 — reached, the table is prepared, and a table the database does not hold throws here.
        get readable() {
            connection()
            readable ??= changesOf<Row>(connection, name)
            return readable
        },
        get writable() {
            connection()
            writable ??= upserts<Row>(connection, name, key)
            return writable
        },
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

/** 47.29 — per database or opener, the tables whose changes refresh what carries their name as a tag. */
const WATCHED = new WeakMap<object, Set<string>>()

/** 47.29, 47.31 — each change to `name` refreshes every value tagged `name`, and old changes go. */
function watchTag(
    owner: object,
    connection: () => Database,
    name: string,
): void {
    let names = WATCHED.get(owner)
    if (names === undefined) {
        names = new Set()
        WATCHED.set(owner, names)
    }
    if (names.has(name)) return
    names.add(name)
    const watched = names
    // 47.29 — the baseline taken where the table is named, so a write before the first look is heard.
    let seen: number | undefined
    try {
        seen = lastChange(connection(), name)
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
            if (seen === undefined) {
                seen = last
                return
            }
            if (last === seen) return
            seen = last
            invalidate({ tags: [name] })
            if (last > CHANGES_KEPT)
                db.query(
                    'DELETE FROM abide_changes WHERE tbl = ? AND seq <= ?',
                ).run(name, last - CHANGES_KEPT)
        },
        () => broken,
        // The app stopped: the next `table` call for this name watches again.
        () => watched.delete(name),
    )
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
    const commit = (rows: Row[]): void => {
        const db = connection()
        db.transaction(() => {
            for (const row of rows) {
                const columns = Object.keys(row)
                for (const column of columns)
                    if (!SQL_IDENTIFIER.test(column))
                        throw new Error(
                            `abide: ${name}'s column ${JSON.stringify(column)} is not an SQL identifier.`,
                        )
                const updates: string[] = []
                for (const column of columns)
                    if (column !== key)
                        updates.push(`"${column}" = excluded."${column}"`)
                const conflict =
                    updates.length === 0
                        ? 'DO NOTHING'
                        : `DO UPDATE SET ${updates.join(', ')}`
                db.query(
                    `INSERT INTO ${name} (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT("${key}") ${conflict}`,
                ).run(...(columns.map((column) => row[column]) as never[]))
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
