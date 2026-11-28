// 58.9 — A LOG KEPT IN SQLITE, one row per entry: the append face `store.sqlite` gives a `ledger`, and
// the log a `table`'s triggers write its changes to (47.23), so both are read by one reader (58.5).
//
// 58.18 — ONE POLL FOR EVERY LOG WATCHED IN THE PROCESS. bun:sqlite has no update hook, and a commit
// another connection makes is seen only by reading, so each watched log's last number is read every
// `LOOK_EVERY` ms — an index read, and nothing more where nothing moved. The poll runs while the app
// does, and is begun again by the next use of a log, so a closed database is never reopened by it.

import type { Database } from 'bun:sqlite'

import type { Logged, LogStore } from '#shared/ledger.ts'
import { appStopSignal } from '#shared/reactive/abortSignal.ts'
import { unrefTimer } from '#shared/reactive/unrefTimer.ts'

/** 58.18 — how often each watched log's last number is read. */
const LOOK_EVERY = 50

/** 58.18 — the look of each log watched in this process, and the one timer making them. */
const WATCHED = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function resume(): void {
    if (timer !== undefined || WATCHED.size === 0 || appStopSignal().aborted)
        return
    timer = setInterval(() => {
        if (appStopSignal().aborted) {
            clearInterval(timer)
            timer = undefined
            return
        }
        for (const look of WATCHED) look()
    }, LOOK_EVERY)
    unrefTimer(timer)
}

/**
 * 58.9 — the log's tables in `db`: a row per entry, the cursors, how far a trim has let go — so the
 * numbering carries on past entries let go (58.2) — and the log's own name, which tells one file's
 * log from another's (58.17).
 */
export function logTables(db: Database, table: string): void {
    db.run(
        `CREATE TABLE IF NOT EXISTS ${table}_log (log TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, key TEXT, entry TEXT NOT NULL, PRIMARY KEY (log, seq))`,
    )
    db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_log_key ON ${table}_log (log, key) WHERE key IS NOT NULL`,
    )
    db.run(
        `CREATE TABLE IF NOT EXISTS ${table}_cursor (log TEXT NOT NULL, name TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (log, name))`,
    )
    db.run(
        `CREATE TABLE IF NOT EXISTS ${table}_trimmed (log TEXT PRIMARY KEY, through INTEGER NOT NULL)`,
    )
    db.run(`CREATE TABLE IF NOT EXISTS ${table}_origin (id TEXT NOT NULL)`)
    db.query(
        `INSERT INTO ${table}_origin (id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM ${table}_origin)`,
    ).run(crypto.randomUUID())
}

/** 58.2 — the SQL answering `log`'s last number, kept or let go, given `log` as its one binding. */
export function lastSql(table: string, log: string): string {
    return `MAX(COALESCE((SELECT MAX(seq) FROM ${table}_log WHERE log = ${log}), 0), COALESCE((SELECT through FROM ${table}_trimmed WHERE log = ${log}), 0))`
}

/** A log kept in SQLite: the append face, its last number read at once, and the watch's own look. */
export type SqliteLog = Omit<LogStore, 'last'> & {
    last: () => number
    look: () => void
    resume: () => void
}

/**
 * The log named `log` in `<table>_log`, in the `Database` `acquire` hands back.
 *
 * Beside the append face: `look` reads the last number now and tells the watch where it moved, for a
 * write made in this process that is heard at once rather than on the poll; `resume` begins the poll
 * again once the app's stop ended it.
 */
export function sqliteLog(
    acquire: () => Database,
    table: string,
    log: () => string,
): SqliteLog {
    const last = `SELECT ${lastSql(table, '?1')} AS last`
    const lastOf = (db: Database): number =>
        (db.query(last).get(log()) as { last: number }).last
    // 58.18 — the last number the watch has passed, and those told it moved.
    let seen: number | undefined
    const listeners = new Set<() => void>()
    // Made in each `Database` the opener hands back; inside a transaction made again at the next use,
    // since its rollback unmakes them.
    let prepared: Database | undefined
    let origin: { db: Database; id: string } | undefined
    const connection = (): Database => {
        const db = acquire()
        if (db !== prepared) {
            logTables(db, table)
            if (!db.inTransaction) prepared = db
        }
        if (listeners.size > 0) {
            if (seen === undefined && !db.inTransaction) seen = lastOf(db)
            resume()
        }
        return db
    }
    const look = (): void => {
        let db: Database
        try {
            db = acquire()
        } catch {
            return
        }
        let now: number
        // A `Database` closed under the watch throws here, and is looked at again on the next tick.
        try {
            // 47.41 — an open transaction's appends are not yet anyone's to hear.
            if (db.inTransaction) return
            now = lastOf(db)
        } catch {
            return
        }
        const moved = seen !== undefined && now !== seen
        seen = now
        if (moved) for (const listener of [...listeners]) listener()
    }
    return {
        append: (entry, entryKey, at) => {
            const db = connection()
            const name = log()
            // One transaction: the number read and the row written are one step, so two appends never
            // take the same number.
            return db.transaction((): number => {
                if (entryKey !== undefined) {
                    const kept = db
                        .query(
                            `SELECT seq FROM ${table}_log WHERE log = ? AND key = ?`,
                        )
                        .get(name, entryKey) as { seq: number } | null
                    if (kept !== null) return kept.seq
                }
                const seq = lastOf(db) + 1
                db.query(
                    `INSERT INTO ${table}_log (log, seq, at, key, entry) VALUES (?, ?, ?, ?, ?)`,
                ).run(name, seq, at, entryKey ?? null, JSON.stringify(entry))
                return seq
            })()
        },
        appendAt: (entry, expected, at) => {
            const db = connection()
            return db.transaction((): number | undefined => {
                if (lastOf(db) !== expected) return undefined
                db.query(
                    `INSERT INTO ${table}_log (log, seq, at, key, entry) VALUES (?, ?, ?, NULL, ?)`,
                ).run(log(), expected + 1, at, JSON.stringify(entry))
                return expected + 1
            })()
        },
        since: (seq) => {
            const rows = connection()
                .query(
                    `SELECT seq, at, entry FROM ${table}_log WHERE log = ? AND seq > ? ORDER BY seq LIMIT 256`,
                )
                .all(log(), seq) as { seq: number; at: number; entry: string }[]
            const entries: Logged<unknown>[] = []
            for (const row of rows)
                entries.push({
                    seq: row.seq,
                    at: row.at,
                    entry: JSON.parse(row.entry),
                })
            return entries
        },
        last: () => lastOf(connection()),
        position: (cursor, seq) => {
            const db = connection()
            const name = log()
            if (seq !== undefined)
                db.query(
                    `INSERT INTO ${table}_cursor (log, name, seq) VALUES (?, ?, ?) ON CONFLICT(log, name) DO UPDATE SET seq = excluded.seq`,
                ).run(name, cursor, seq)
            const row = db
                .query(
                    `SELECT seq FROM ${table}_cursor WHERE log = ? AND name = ?`,
                )
                .get(name, cursor) as { seq: number } | null
            return row?.seq ?? 0
        },
        trim: (through) => {
            const db = connection()
            const name = log()
            // 58.2 — how far the trim let go is kept, so the next append numbers past it.
            db.transaction(() => {
                db.query(
                    `DELETE FROM ${table}_log WHERE log = ? AND seq <= ?`,
                ).run(name, through)
                db.query(
                    `INSERT INTO ${table}_trimmed (log, through) VALUES (?1, ?2) ON CONFLICT (log) DO UPDATE SET through = MAX(through, ?2)`,
                ).run(name, through)
            })()
        },
        // 58.17 — the file's log, read once per `Database`.
        origin: () => {
            const db = connection()
            if (origin?.db !== db)
                origin = {
                    db,
                    id: (
                        db.query(`SELECT id FROM ${table}_origin`).get() as {
                            id: string
                        }
                    ).id,
                }
            return origin.id
        },
        // 58.18 — a watch begins at the log's next use, so a ledger made at import opens nothing.
        watch: (changed) => {
            listeners.add(changed)
            WATCHED.add(look)
            return () => {
                listeners.delete(changed)
                if (listeners.size === 0) {
                    WATCHED.delete(look)
                    seen = undefined
                }
            }
        },
        look,
        resume: () => {
            if (listeners.size === 0) return
            if (seen === undefined) look()
            resume()
        },
    }
}
