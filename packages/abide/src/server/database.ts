import { Database, type DatabaseOptions } from 'bun:sqlite'
import { mkdirSync, readdirSync, rmSync } from 'node:fs' // bun exposes no directory creation or listing, nor synchronous removal, of its own
import { dirname, resolve } from 'node:path' // bun exposes no path resolution of its own

import { config, derived } from './config.ts'
import { onStop } from './hooks.ts'

/** 47.2, 47.3 — a name, opened as `<name>.sqlite`. A string neither a name nor a path is refused. */
const NAME = /^[\w-]+$/

/** 47.3 — a path: anything holding a `/` or a `.`, so `todos.sqlite` is the file it says. */
const PATH = /[/.]/

const IN_MEMORY = ':memory:'

const BUSY_TIMEOUT = 5000

/** 47.17 — what SQLite keeps beside a WAL file, removed with it. */
const BESIDE = ['', '-wal', '-shm']

type Migration = string | ((database: Database) => void)

type Options = Pick<DatabaseOptions, 'readonly' | 'safeIntegers' | 'strict'> & {
    migrations?: Migration[]
    openNewer?: boolean
    open?: (database: Database) => void
}

/**
 * 47.4 — the scratch directory each test file opens its databases under, keyed by `Bun.main`: `bun
 * test` without `--isolate` runs every file in one module registry, and `Bun.main` is the file running.
 */
const scratchDirectories = new Map<string, string>()

/** 47.19 — a scratch directory's name, carrying the pid of the process that made it. */
const SCRATCH = /^abide-test-(\d+)-/

/**
 * The opener of the app's SQLite database `file`: the first call opens and migrates it, and every
 * call after hands back the same `bun:sqlite` `Database`, until `close` or the app's stop closes it.
 *
 * `file` is a name (`'todos'` is `todos.sqlite` in `APP_DATA_DIR`), a path holding a `/` or a `.`
 * (relative to the working directory), or `':memory:'` — or a function returning one, called as the
 * file opens so it can read `config()`.
 *
 * 47.6 — `PRAGMA user_version` counts the migrations a file has applied, so each runs once, in
 * order, however many times the app boots. A function migration is for what SQL cannot say alone:
 * a backfill computed in JavaScript, or the rows a first boot seeds — and the opener called from
 * inside one hands back the `Database` it migrates (47.20), so a seed can call the app's own
 * helpers. `open` runs at every open, for what a connection holds rather than the file: a pragma
 * like `synchronous`.
 */
export function database(
    file: string | (() => string),
    options?: Options,
): (() => Database) & { close: (options?: { remove?: boolean }) => void } {
    if (typeof file === 'string') checked(file)
    let opened: Database | undefined
    // 47.4 — the test file a scratch database was opened for.
    let scratchFor: string | undefined
    // 47.16, 47.17.
    const close = (closing?: { remove?: boolean }): void => {
        const filename = opened?.filename
        opened?.close()
        opened = undefined
        if (
            closing?.remove === true &&
            filename !== undefined &&
            filename !== IN_MEMORY
        )
            for (const suffix of BESIDE)
                rmSync(`${filename}${suffix}`, { force: true })
    }
    // 47.10, 47.11 — CLOSED AS THE APP STOPS, after the teardown it wraps, and opened again by the next
    // call.
    onStop(async (stop) => {
        await stop()
        close()
    })
    // 47.20, 47.21 — a call made while the opener opens: `migrating` is the `Database` a migration
    // running now migrates, and any other such call, from `file` or `open`, cannot be served — opening
    // again would run the same migrations on a second connection, which recurses or waits out the busy
    // timeout on the first one's write lock.
    let opening = false
    let migrating: Database | undefined
    // 47.11 — an open that threw caches nothing, so the next call tries again.
    const opener = (): Database => {
        if (migrating !== undefined) return migrating
        if (opening)
            throw new Error(
                'abide: a database opener was called while it opens, outside a migration — from its file function or its open hook. RULEBOOK 47.21.',
            )
        if (scratchFor !== undefined && scratchFor !== Bun.main) close()
        if (opened === undefined) {
            const scratch = process.env.NODE_ENV === 'test'
            opening = true
            try {
                // 47.12 — the function is called per open, 47.4's scratch included.
                const named = checked(typeof file === 'string' ? file : file())
                opened = open(named, scratch, options, (db) => {
                    migrating = db
                })
            } finally {
                opening = false
                migrating = undefined
            }
            scratchFor = scratch ? Bun.main : undefined
        }
        return opened
    }
    return Object.assign(opener, { close })
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
    scratch: boolean,
    options: Options | undefined,
    migrationsBegin: (db: Database) => void,
): Database {
    const migrations = options?.migrations ?? []
    const readonly = options?.readonly === true
    // 47.14 — bun refuses `create` beside `readonly`.
    const db = new Database(pathOf(file, scratch), {
        create: !readonly,
        readonly,
        safeIntegers: options?.safeIntegers === true,
        strict: options?.strict === true,
    })
    try {
        // 47.5.
        db.run('PRAGMA journal_mode = WAL')
        db.run('PRAGMA foreign_keys = ON')
        db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT}`)
        // 47.15.
        options?.open?.(db)
        // `safeIntegers` reads it as a bigint.
        const applied = Number(
            (
                db.query('PRAGMA user_version').get() as {
                    user_version: number | bigint
                }
            ).user_version,
        )
        // 47.9 — A NEWER BUILD MIGRATED THIS FILE, and this one cannot say what its schema is.
        if (applied > migrations.length) {
            // 47.13 — unless the app said it reads one, and then the file is left as it is.
            if (options?.openNewer === true) return db
            throw new Error(
                `abide: database ${JSON.stringify(file)} is at migration ${applied}, past the ${migrations.length} this build declares. RULEBOOK 47.9.`,
            )
        }
        // 47.18 — a file that is current is not written, so a `readonly` one opens.
        if (applied === migrations.length) return db
        // 47.7 — ONE TRANSACTION, so a throw leaves the file at the version it opened at.
        let running = applied
        migrationsBegin(db)
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

/**
 * 47.2, 47.3 — a name's file under `APP_DATA_DIR`, a path from the working directory, or memory; and
 * 47.4 — under `bun test`, that path inside the running test file's scratch directory.
 */
function pathOf(file: string, scratch: boolean): string {
    if (file === IN_MEMORY) return file
    const named = PATH.test(file)
        ? resolve(file)
        : `${String(config.peek()?.APP_DATA_DIR ?? derived().APP_DATA_DIR)}/${file}.sqlite`
    const path = scratch ? `${scratchDirectory()}${named}` : named
    mkdirSync(dirname(path), { recursive: true })
    return path
}

function scratchDirectory(): string {
    let directory = scratchDirectories.get(Bun.main)
    if (directory === undefined) {
        const temporary = (Bun.env.TMPDIR ?? '/tmp').replace(/\/$/, '')
        // 47.19 — `bun test` runs no `exit` listener, so what a finished process left is removed by
        // the next one to make a scratch directory.
        if (scratchDirectories.size === 0)
            for (const name of readdirSync(temporary)) {
                const pid = SCRATCH.exec(name)?.[1]
                if (pid !== undefined && !running(Number(pid)))
                    rmSync(`${temporary}/${name}`, {
                        recursive: true,
                        force: true,
                    })
            }
        directory = `${temporary}/abide-test-${process.pid}-${crypto.randomUUID()}`
        scratchDirectories.set(Bun.main, directory)
    }
    return directory
}

function running(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        // EPERM is a process that runs as another user.
        return (error as { code?: string }).code !== 'ESRCH'
    }
}
