import { Database } from 'bun:sqlite'

import type { Store } from '#shared'
import type { Schema } from '#shared/Schema.ts'
import { expiresAfter, storedValue } from '#shared/storedValue.ts'

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** One connection per path a store names, so a `Keyed` building a store per entry opens one file. */
const OPENED = new Map<string, Database>()

/**
 * A `Store` kept in a row of a `bun:sqlite` table, under `key`.
 *
 * 8.25 — the table is made where it is missing, and its shape is the store's: the key, the value as
 * JSON, and the deadline 8.26 reads, as epoch milliseconds or `NULL` for never.
 */
export function sqliteStore<Stored>(
    database: Database | string,
    key: string,
    options?: { table?: string; schema?: Schema<Stored> },
): Store<Stored> {
    const table = options?.table ?? 'abide_store'
    if (!IDENTIFIER.test(table))
        throw new Error(
            `sqliteStore's table ${JSON.stringify(table)} is not an SQL identifier.`,
        )
    const db = typeof database === 'string' ? opened(database) : database
    db.run(
        `CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER)`,
    )
    const schema = options?.schema as Schema<unknown> | undefined
    const where = `${table}[${JSON.stringify(key)}]`
    return {
        get: () => {
            const row = db
                .query(`SELECT value, expires FROM ${table} WHERE key = ?`)
                .get(key) as { value: string; expires: number | null } | null
            if (row === null) return undefined
            const value = storedValue(
                { value: JSON.parse(row.value), expires: row.expires },
                schema,
                where,
            )
            // 8.26 — a row past its deadline is gone, not merely skipped.
            if (value === undefined)
                db.query(`DELETE FROM ${table} WHERE key = ?`).run(key)
            return value as Stored | undefined
        },
        set: (value, retention) => {
            db.query(
                `INSERT INTO ${table} (key, value, expires) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires = excluded.expires`,
            ).run(key, JSON.stringify(value), expiresAfter(retention.ttl))
        },
    }
}

function opened(path: string): Database {
    let db = OPENED.get(path)
    if (db === undefined) {
        db = new Database(path, { create: true })
        OPENED.set(path, db)
    }
    return db
}
