import type { Database } from 'bun:sqlite'

import { database as opener } from '#server/database.ts'
import type { Store } from '#shared'
import type { Logged, LogStore } from '#shared/ledger.ts'
import type { Schema } from '#shared/Schema.ts'
import { expiresAfter, storedValue, storeKey } from '#shared/storedValue.ts'

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 8.41 — one opener per string a store names, so a `Keyed` building a store per entry opens one file. */
const OPENERS = new Map<string, () => Database>()

/**
 * A `Store` kept in a row of a `bun:sqlite` table, under `key`.
 *
 * `database` is an opener — `database(…)`'s, called at each `get` and `set`, so a store outlives the
 * `Database` an app's stop closes (8.41) — a string `database(…)` opens (8.42), or a `Database` the
 * app holds itself.
 *
 * 8.25, 8.29 — the table is made where it is missing, and its shape is the store's: the key, the value as
 * JSON, and the deadline 8.26 reads, as epoch milliseconds or `NULL` for never.
 *
 * 58.9 — AND AN APPEND FACE, for a `ledger`: a row per entry in `<table>_log` under the same key, and
 * a row per named cursor in `<table>_cursor`, so an append is one row however long the log is.
 */
export function sqlite<Stored>(
    database: Database | (() => Database) | string,
    key: string,
    options?: {
        table?: string | undefined
        schema?: Schema<Stored> | undefined
    },
): Store<Stored> & LogStore {
    const table = options?.table ?? 'abide_store'
    if (!IDENTIFIER.test(table))
        throw new Error(
            `store.sqlite's table ${JSON.stringify(table)} is not an SQL identifier.`,
        )
    const acquire =
        typeof database === 'string'
            ? openerOf(database)
            : typeof database === 'function'
              ? database
              : () => database
    // 8.25 — made in each `Database` the opener hands back, since a reopened `:memory:` holds none; and
    // at the first `get` or `set` rather than here, so an opener reading `config()` is called no sooner
    // than the app would call it.
    let prepared: Database | undefined
    const connection = (): Database => {
        const db = acquire()
        if (db !== prepared) {
            db.run(
                `CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER)`,
            )
            prepared = db
        }
        return db
    }
    // 58.9 — made at the first append, read or cursor, as the value's table is at the first get or set.
    let logged: Database | undefined
    const logConnection = (): Database => {
        const db = acquire()
        if (db !== logged) {
            db.run(
                `CREATE TABLE IF NOT EXISTS ${table}_log (log TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, key TEXT, entry TEXT NOT NULL, PRIMARY KEY (log, seq))`,
            )
            db.run(
                `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_log_key ON ${table}_log (log, key) WHERE key IS NOT NULL`,
            )
            db.run(
                `CREATE TABLE IF NOT EXISTS ${table}_cursor (log TEXT NOT NULL, name TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (log, name))`,
            )
            logged = db
        }
        return db
    }
    const schema = options?.schema as Schema<unknown> | undefined
    return {
        get: () => {
            const stored = storeKey(key)
            const db = connection()
            const row = db
                .query(`SELECT value, expires FROM ${table} WHERE key = ?`)
                .get(stored) as { value: string; expires: number | null } | null
            if (row === null) return undefined
            const value = storedValue(
                { value: JSON.parse(row.value), expires: row.expires },
                schema,
                `${table}[${JSON.stringify(stored)}]`,
            )
            // 8.26 — a row past its deadline is gone, not merely skipped.
            if (value === undefined)
                db.query(`DELETE FROM ${table} WHERE key = ?`).run(stored)
            return value as Stored | undefined
        },
        set: (value, retention) => {
            connection()
                .query(
                    `INSERT INTO ${table} (key, value, expires) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires = excluded.expires`,
                )
                .run(
                    storeKey(key),
                    JSON.stringify(value),
                    expiresAfter(retention.ttl),
                )
        },
        append: (entry, entryKey, at) => {
            const db = logConnection()
            const log = storeKey(key)
            // One transaction: the number read and the row written are one step, so two appends never
            // take the same number.
            return db.transaction((): number => {
                if (entryKey !== undefined) {
                    const seen = db
                        .query(
                            `SELECT seq FROM ${table}_log WHERE log = ? AND key = ?`,
                        )
                        .get(log, entryKey) as { seq: number } | null
                    if (seen !== null) return seen.seq
                }
                const seq = lastOf(db, log) + 1
                db.query(
                    `INSERT INTO ${table}_log (log, seq, at, key, entry) VALUES (?, ?, ?, ?, ?)`,
                ).run(log, seq, at, entryKey ?? null, JSON.stringify(entry))
                return seq
            })()
        },
        since: (seq) => {
            const rows = logConnection()
                .query(
                    `SELECT seq, at, entry FROM ${table}_log WHERE log = ? AND seq > ? ORDER BY seq LIMIT 256`,
                )
                .all(storeKey(key), seq) as {
                seq: number
                at: number
                entry: string
            }[]
            const entries: Logged<unknown>[] = []
            for (const row of rows)
                entries.push({
                    seq: row.seq,
                    at: row.at,
                    entry: JSON.parse(row.entry),
                })
            return entries
        },
        last: () => lastOf(logConnection(), storeKey(key)),
        position: (cursor, seq) => {
            const db = logConnection()
            const log = storeKey(key)
            if (seq !== undefined)
                db.query(
                    `INSERT INTO ${table}_cursor (log, name, seq) VALUES (?, ?, ?) ON CONFLICT(log, name) DO UPDATE SET seq = excluded.seq`,
                ).run(log, cursor, seq)
            const row = db
                .query(
                    `SELECT seq FROM ${table}_cursor WHERE log = ? AND name = ?`,
                )
                .get(log, cursor) as { seq: number } | null
            return row?.seq ?? 0
        },
        trim: (through) => {
            logConnection()
                .query(`DELETE FROM ${table}_log WHERE log = ? AND seq <= ?`)
                .run(storeKey(key), through)
        },
    }

    function lastOf(db: Database, log: string): number {
        const row = db
            .query(`SELECT MAX(seq) AS last FROM ${table}_log WHERE log = ?`)
            .get(log) as { last: number | null }
        return row.last ?? 0
    }
}

function openerOf(file: string): () => Database {
    let opened = OPENERS.get(file)
    if (opened === undefined) {
        opened = opener(file)
        OPENERS.set(file, opened)
    }
    return opened
}
