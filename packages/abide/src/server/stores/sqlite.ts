import type { Database } from 'bun:sqlite'

import { database as opener } from '#server/database.ts'
import type { Store } from '#shared'
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
 */
export function sqlite<Stored>(
    database: Database | (() => Database) | string,
    key: string,
    options?: { table?: string; schema?: Schema<Stored> },
): Store<Stored> {
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
