import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs' // bun exposes no directory creation of its own

import { config, derived } from './config.ts'
import { onStop } from './hooks.ts'

/** 47.3 — a file name, and nothing that reaches out of `APP_DATA_DIR`. */
const NAME = /^[\w-][\w.-]*$/

const BUSY_TIMEOUT = 5000

/**
 * The opener of the app's SQLite database `name`: the first call opens and migrates it, and every
 * call after hands back the same `bun:sqlite` `Database`.
 *
 * 47.6 — `PRAGMA user_version` counts the migrations a file has applied, so each runs once, in
 * order, however many times the app boots. A function migration is for what SQL cannot say alone:
 * a backfill computed in JavaScript, or the rows a first boot seeds.
 */
export function database(
    name: string,
    options?: { migrations?: (string | ((database: Database) => void))[] },
): () => Database {
    if (!NAME.test(name))
        throw new Error(
            `abide: database ${JSON.stringify(name)} is not a file name. RULEBOOK 47.3.`,
        )
    const migrations = options?.migrations ?? []
    let opened: Database | undefined
    // 47.10, 47.11 — CLOSED AS THE APP STOPS, after the teardown it wraps, and opened again by the next
    // call.
    onStop(async (stop) => {
        await stop()
        opened?.close()
        opened = undefined
    })
    // 47.11 — an open that threw caches nothing, so the next call tries again.
    return () => {
        opened ??= open(name, migrations)
        return opened
    }
}

function open(
    name: string,
    migrations: readonly (string | ((database: Database) => void))[],
): Database {
    const db = new Database(fileOf(name), { create: true })
    try {
        // 47.5.
        db.run('PRAGMA journal_mode = WAL')
        db.run('PRAGMA foreign_keys = ON')
        db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT}`)
        const { user_version: applied } = db
            .query('PRAGMA user_version')
            .get() as { user_version: number }
        // 47.9 — A NEWER BUILD MIGRATED THIS FILE, and this one cannot say what its schema is.
        if (applied > migrations.length)
            throw new Error(
                `abide: database ${JSON.stringify(name)} is at migration ${applied}, past the ${migrations.length} this build declares. RULEBOOK 47.9.`,
            )
        // 47.7 — ONE TRANSACTION, so a throw leaves the file at the version it opened at.
        let running = applied
        try {
            db.transaction(() => {
                for (; running < migrations.length; running += 1) {
                    const migration = migrations[running]
                    if (typeof migration === 'string') db.run(migration)
                    else migration?.(db)
                }
                db.run(`PRAGMA user_version = ${migrations.length}`)
            })()
        } catch (error) {
            throw new Error(
                `abide: database ${JSON.stringify(name)}'s migration ${running + 1} threw, and the database stays at migration ${applied}. RULEBOOK 47.7.`,
                { cause: error },
            )
        }
        return db
    } catch (error) {
        db.close()
        throw error
    }
}

/** 47.2, 47.4 — the file under `APP_DATA_DIR`, or a scratch database in memory under `bun test`. */
function fileOf(name: string): string {
    if (process.env.NODE_ENV === 'test') return ':memory:'
    const directory = String(
        config.peek()?.APP_DATA_DIR ?? derived().APP_DATA_DIR,
    )
    mkdirSync(directory, { recursive: true })
    return `${directory}/${name}.sqlite`
}
