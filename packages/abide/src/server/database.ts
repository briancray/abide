import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs' // bun exposes no directory creation of its own
import { dirname, resolve } from 'node:path' // bun exposes no path resolution of its own

import { config, derived } from './config.ts'
import { onStop } from './hooks.ts'

/** 47.2, 47.3 — a name, opened as `<name>.sqlite`. A string neither a name nor a path is refused. */
const NAME = /^[\w-]+$/

/** 47.3 — a path: anything holding a `/` or a `.`, so `todos.sqlite` is the file it says. */
const PATH = /[/.]/

const IN_MEMORY = ':memory:'

const BUSY_TIMEOUT = 5000

type Migration = string | ((database: Database) => void)

/**
 * The opener of the app's SQLite database `file`: the first call opens and migrates it, and every
 * call after hands back the same `bun:sqlite` `Database`.
 *
 * `file` is a name (`'todos'` is `todos.sqlite` in `APP_DATA_DIR`), a path holding a `/` or a `.`
 * (relative to the working directory), or `':memory:'` — or a function returning one, called as the
 * file opens so it can read `config()`.
 *
 * 47.6 — `PRAGMA user_version` counts the migrations a file has applied, so each runs once, in
 * order, however many times the app boots. A function migration is for what SQL cannot say alone:
 * a backfill computed in JavaScript, or the rows a first boot seeds.
 */
export function database(
    file: string | (() => string),
    options?: { migrations?: Migration[]; openNewer?: boolean },
): () => Database {
    if (typeof file === 'string') checked(file)
    const migrations = options?.migrations ?? []
    const openNewer = options?.openNewer === true
    let opened: Database | undefined
    // 47.4 — the test file a scratch database was opened for. `bun test` without `--isolate` runs
    // every file in one module registry, so one opener reaches every file, and `Bun.main` is the
    // file running.
    let scratchFor: string | undefined
    // 47.10, 47.11 — CLOSED AS THE APP STOPS, after the teardown it wraps, and opened again by the next
    // call.
    onStop(async (stop) => {
        await stop()
        opened?.close()
        opened = undefined
    })
    // 47.11 — an open that threw caches nothing, so the next call tries again.
    return () => {
        if (scratchFor !== undefined && scratchFor !== Bun.main) {
            opened?.close()
            opened = undefined
        }
        if (opened === undefined) {
            const scratch = process.env.NODE_ENV === 'test'
            // 47.12 — the function is called per open, and never for 47.4's scratch.
            const named = scratch
                ? IN_MEMORY
                : checked(typeof file === 'string' ? file : file())
            opened = open(named, migrations, openNewer)
            scratchFor = scratch ? Bun.main : undefined
        }
        return opened
    }
}

function checked(file: string): string {
    if (file !== IN_MEMORY && !PATH.test(file) && !NAME.test(file))
        throw new Error(
            `abide: database ${JSON.stringify(file)} is not a file name. RULEBOOK 47.3.`,
        )
    return file
}

function open(
    file: string,
    migrations: readonly Migration[],
    openNewer: boolean,
): Database {
    const db = new Database(pathOf(file), { create: true })
    try {
        // 47.5.
        db.run('PRAGMA journal_mode = WAL')
        db.run('PRAGMA foreign_keys = ON')
        db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT}`)
        const { user_version: applied } = db
            .query('PRAGMA user_version')
            .get() as { user_version: number }
        // 47.9 — A NEWER BUILD MIGRATED THIS FILE, and this one cannot say what its schema is.
        if (applied > migrations.length) {
            // 47.13 — unless the app said it reads one, and then the file is left as it is.
            if (openNewer) return db
            throw new Error(
                `abide: database ${JSON.stringify(file)} is at migration ${applied}, past the ${migrations.length} this build declares. RULEBOOK 47.9.`,
            )
        }
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
                `abide: database ${JSON.stringify(file)}'s migration ${running + 1} threw, and the database stays at migration ${applied}. RULEBOOK 47.7.`,
                { cause: error },
            )
        }
        return db
    } catch (error) {
        db.close()
        throw error
    }
}

/** 47.2, 47.3 — a name's file under `APP_DATA_DIR`, a path from the working directory, or memory. */
function pathOf(file: string): string {
    if (file === IN_MEMORY) return file
    const path = PATH.test(file)
        ? resolve(file)
        : `${String(config.peek()?.APP_DATA_DIR ?? derived().APP_DATA_DIR)}/${file}.sqlite`
    mkdirSync(dirname(path), { recursive: true })
    return path
}
