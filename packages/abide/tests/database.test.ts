// `database` (RULEBOOK 47). The claims are about the FILE: what it holds after a boot, and after a
// second boot over it — so most tests here open a real file under a temporary `APP_DATA_DIR`, with
// `NODE_ENV` moved off `test` for the length of the test, which is 47.4's scratch otherwise.

import { Database } from 'bun:sqlite'
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync } from 'node:fs' // bun exposes no directory creation, nor a directory's existence, of its own

import { spawned } from '@abide/harness/gate'

import { config } from '#server/config.ts'
import { database } from '#server/database.ts'
import { sqlite } from '#server/stores/sqlite.ts'
import { reactive } from '#shared'

import { inMemoryApp } from './inMemoryApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

const environmentAsFound = process.env.NODE_ENV
const dataDirectoryAsFound = process.env.APP_DATA_DIR
let directory = ''
let counter = 0

// A directory of its own per test, so no test reads a file another wrote.
function onDisk(): void {
    counter += 1
    // Without TMPDIR's trailing `/`, so a path reads back as `database` resolved it.
    directory = `${(Bun.env.TMPDIR ?? '/tmp').replace(/\/$/, '')}/abide-database-${process.pid}-${counter}`
    process.env.NODE_ENV = 'production'
    process.env.APP_DATA_DIR = directory
    config.invalidate()
}

beforeEach(() => {
    directory = ''
})
afterEach(async () => {
    process.env.NODE_ENV = environmentAsFound ?? 'test'
    if (dataDirectoryAsFound === undefined) delete process.env.APP_DATA_DIR
    else process.env.APP_DATA_DIR = dataDirectoryAsFound
    config.invalidate()
    if (directory !== '') await Bun.$`rm -rf ${directory}`.quiet().nothrow()
})

const versionOf = (db: Database): number =>
    (db.query('PRAGMA user_version').get() as { user_version: number })
        .user_version

const CARS = 'CREATE TABLE cars (id INTEGER PRIMARY KEY, vin TEXT NOT NULL)'
const TRIM = "ALTER TABLE cars ADD COLUMN trim TEXT NOT NULL DEFAULT ''"

test('a database is a file named for it under APP_DATA_DIR, made where missing — 47.1, 47.2, 47.5', async () => {
    onDisk()
    const garage = database('garage', { migrations: [CARS] })
    const db = garage()
    expect(garage()).toBe(db)
    expect(await Bun.file(`${directory}/garage.sqlite`).exists()).toBe(true)
    expect([
        db.query('PRAGMA journal_mode').get(),
        db.query('PRAGMA foreign_keys').get(),
        db.query('PRAGMA busy_timeout').get(),
    ]).toEqual([
        { journal_mode: 'wal' },
        { foreign_keys: 1 },
        { timeout: 5000 },
    ])
    db.close()
})

test('each migration runs once, in order, across boots over one file — 47.6, 47.8', () => {
    onDisk()
    let seeded = 0
    // Writes the column the migration before it added, so it runs after it or throws.
    const seed = (db: Database): void => {
        seeded += 1
        db.run("INSERT INTO cars (vin, trim) VALUES ('1G1YB', 'Stingray')")
    }
    const first = database('garage', { migrations: [CARS, TRIM, seed] })()
    expect(versionOf(first)).toBe(3)
    first.close()
    // A second boot, with a migration a later build added.
    const second = database('garage', {
        migrations: [CARS, TRIM, seed, "UPDATE cars SET trim = trim || ' 2LT'"],
    })()
    expect({
        version: versionOf(second),
        seeded,
        cars: second.query('SELECT vin, trim FROM cars').all(),
    }).toEqual({
        version: 4,
        seeded: 1,
        cars: [{ vin: '1G1YB', trim: 'Stingray 2LT' }],
    })
    second.close()
})

test('a migration that throws keeps none of the ones it ran with, and the next call tries again — 47.7, 47.11', () => {
    onDisk()
    database('garage', { migrations: [CARS] })().close()
    let broken = true
    const garage = database('garage', {
        migrations: [
            CARS,
            TRIM,
            (db) => {
                if (broken) throw new Error('no such car')
                db.run("INSERT INTO cars (vin) VALUES ('1G1YB')")
            },
        ],
    })
    expect(() => garage()).toThrow(
        'abide: database "garage"\'s migration 3 threw, and the database stays at migration 1. RULEBOOK 47.7.',
    )
    const after = new Database(`${directory}/garage.sqlite`)
    expect({
        version: versionOf(after),
        columns: (
            after.query('PRAGMA table_info(cars)').all() as { name: string }[]
        ).map((column) => column.name),
    }).toEqual({ version: 1, columns: ['id', 'vin'] })
    after.close()
    broken = false
    const db = garage()
    expect(versionOf(db)).toBe(3)
    db.close()
})

test('a file a newer build migrated is refused, not opened — 47.9', () => {
    onDisk()
    database('garage', { migrations: [CARS, TRIM] })().close()
    expect(() => database('garage', { migrations: [CARS] })()).toThrow(
        'abide: database "garage" is at migration 2, past the 1 this build declares. RULEBOOK 47.9.',
    )
})

// 47.2, 47.3 — THE REVERT: resolve a relative path against APP_DATA_DIR in `pathOf`; the two
// relative paths open under it rather than under the working directory. Or read only a `/` as a
// path; `garage.sqlite` opens `garage.sqlite.sqlite` in APP_DATA_DIR.
test('a path opens that file, relative to the working directory, and a bare name opens under APP_DATA_DIR — 47.2, 47.3', async () => {
    onDisk()
    mkdirSync(`${directory}/work`, { recursive: true })
    const workingAsFound = process.cwd()
    process.chdir(`${directory}/work`)
    try {
        const working = process.cwd()
        const opened = [
            `${directory}/elsewhere/garage.sqlite`,
            'data/garage.sqlite',
            'garage.sqlite',
            'garage',
        ].map((file) => database(file, { migrations: [CARS] })())
        expect(opened.map((db) => db.filename)).toEqual([
            `${directory}/elsewhere/garage.sqlite`,
            `${working}/data/garage.sqlite`,
            `${working}/garage.sqlite`,
            `${directory}/garage.sqlite`,
        ])
        for (const db of opened) db.close()
    } finally {
        process.chdir(workingAsFound)
    }
})

// 47.3 — THE REVERT: drop the `IN_MEMORY` test from `pathOf`; `:memory:` opens a file of that name
// under APP_DATA_DIR, and the second opener reads the first's car.
test('`:memory:` opens a database in memory, of its own per opener — 47.3', async () => {
    onDisk()
    const one = database(':memory:', { migrations: [CARS] })()
    one.run("INSERT INTO cars (vin) VALUES ('1G1YB')")
    const two = database(':memory:', { migrations: [CARS] })()
    expect({
        other: two.query('SELECT COUNT(*) AS cars FROM cars').get(),
        written: await Bun.file(`${directory}/:memory:`).exists(),
    }).toEqual({ other: { cars: 0 }, written: false })
    one.close()
    two.close()
})

// 47.12 — THE REVERT: call the function where `database` is called, not at the open; it reads
// `GARAGE_DB` before the app set it, and the file opens at `undefined`.
test('a function names the file as it opens, so it reads the config of that moment — 47.12', async () => {
    onDisk()
    let calls = 0
    const garage = database(
        () => {
            calls += 1
            return String(config().GARAGE_DB)
        },
        { migrations: [CARS] },
    )
    const before = calls
    process.env.GARAGE_DB = `${directory}/configured.sqlite`
    config.invalidate()
    try {
        const db = garage()
        garage()
        expect({ before, calls, file: db.filename }).toEqual({
            before: 0,
            calls: 1,
            file: `${directory}/configured.sqlite`,
        })
        db.close()
    } finally {
        delete process.env.GARAGE_DB
    }
})

// 47.12, 47.4 — THE REVERT: skip the function under `NODE_ENV=test`, as 47.4 once read; it is
// called 0 times, and a config guard inside it never throws under test.
test('under bun test the function is still called, and what it names opens inside the scratch directory — 47.4, 47.12', () => {
    let calls = 0
    const garage = database(
        () => {
            calls += 1
            return '/nowhere/garage.sqlite'
        },
        { migrations: [CARS] },
    )
    const unconfigured = database(() => {
        throw new Error('GARAGE_DB is not configured')
    })
    const file = garage().filename
    expect({
        calls,
        scratch:
            file.endsWith('/nowhere/garage.sqlite') &&
            !file.startsWith('/nowhere'),
    }).toEqual({ calls: 1, scratch: true })
    expect(() => unconfigured()).toThrow('GARAGE_DB is not configured')
    garage.close()
})

// 47.13 — THE REVERT: drop the `openNewer` return in `open`; it throws 47.9, or, past the throw, the
// transaction lowers the file to migration 1.
test('openNewer opens a file a newer build migrated, running nothing and lowering nothing — 47.13', () => {
    onDisk()
    database('garage', { migrations: [CARS, TRIM] })().close()
    let ran = 0
    const db = database('garage', {
        migrations: [
            (db) => {
                ran += 1
                db.run(CARS)
            },
        ],
        openNewer: true,
    })()
    db.run("INSERT INTO cars (vin, trim) VALUES ('1G1YB', 'Stingray')")
    expect({ version: versionOf(db), ran }).toEqual({ version: 2, ran: 0 })
    db.close()
})

// THE ADOPTION PATH, which is 47.6 alone: a file an app made before it used `database` sits at
// `user_version` 0 with its tables already there, and migration 1 written with IF NOT EXISTS passes
// over them. THE REVERT: write migration 1 without IF NOT EXISTS; the open throws 47.7.
test('a file made before `database` adopts it through an idempotent first migration — 47.6', () => {
    onDisk()
    mkdirSync(directory, { recursive: true })
    const before = new Database(`${directory}/garage.sqlite`, { create: true })
    before.run(CARS)
    before.run("INSERT INTO cars (vin) VALUES ('1G1YB')")
    before.close()
    const db = database('garage', {
        migrations: [
            'CREATE TABLE IF NOT EXISTS cars (id INTEGER PRIMARY KEY, vin TEXT NOT NULL)',
            TRIM,
        ],
    })()
    expect({
        version: versionOf(db),
        cars: db.query('SELECT vin, trim FROM cars').all(),
    }).toEqual({ version: 2, cars: [{ vin: '1G1YB', trim: '' }] })
    db.close()
})

test('a name that is not a file name is refused — 47.3', () => {
    for (const name of ['', 'cars\\garage', ':memory', 'two words'])
        expect(() => database(name)).toThrow(
            `abide: database ${JSON.stringify(name)} is not a file name. RULEBOOK 47.3.`,
        )
    onDisk()
    expect(() => database(() => 'two words')()).toThrow(
        'abide: database "two words" is not a file name. RULEBOOK 47.3.',
    )
})

// 47.4 — THE REVERT: open the named file under `NODE_ENV=test` too; the named file is written. Or open
// the scratch in memory, as 47.4 once read; the second opener and the second connection read 0 cars.
test('under bun test two openers of one file share its scratch file, and a second connection reads what the first wrote — 47.4', async () => {
    directory = `${Bun.env.TMPDIR ?? '/tmp'}/abide-database-${process.pid}-scratch`
    process.env.APP_DATA_DIR = directory
    config.invalidate()
    const one = database('garage', { migrations: [CARS] })
    one().run("INSERT INTO cars (vin) VALUES ('1G1YB')")
    const two = database('garage', { migrations: [CARS] })
    const outside = new Database(one().filename)
    expect({
        two: two().query('SELECT COUNT(*) AS cars FROM cars').get(),
        outside: outside.query('SELECT COUNT(*) AS cars FROM cars').get(),
        written: await Bun.file(`${directory}/garage.sqlite`).exists(),
    }).toEqual({ two: { cars: 1 }, outside: { cars: 1 }, written: false })
    outside.close()
    one.close({ remove: true })
    two.close()
})

// 47.10, 47.4 — THE REVERT: open 47.4's scratch in memory; the app's stop closes it and the call after
// it reads no table at all.
test('under bun test a database the app stop closed opens again with what it held — 47.4, 47.10', async () => {
    const garage = database('stopped', { migrations: [CARS] })
    garage().run("INSERT INTO cars (vin) VALUES ('1G1YB')")
    const app = await inMemoryApp({})
    await app.stop()
    expect(garage().query('SELECT vin FROM cars').all()).toEqual([
        { vin: '1G1YB' },
    ])
    garage.close({ remove: true })
})

// 47.16, 47.17 — THE REVERT: drop the `rmSync` from `close`; the reopened file still holds the car.
// Or drop `opened = undefined`; the call after `close` hands back the closed handle, and throws.
test('close keeps the file and the next call opens it again; close with remove opens it empty and migrated — 47.16, 47.17', () => {
    const garage = database('closed', { migrations: [CARS] })
    garage().run("INSERT INTO cars (vin) VALUES ('1G1YB')")
    garage.close()
    const kept = garage().query('SELECT COUNT(*) AS cars FROM cars').get()
    garage.close({ remove: true })
    expect({
        kept,
        removed: garage().query('SELECT COUNT(*) AS cars FROM cars').get(),
        version: versionOf(garage()),
    }).toEqual({ kept: { cars: 1 }, removed: { cars: 0 }, version: 1 })
    garage.close({ remove: true })
})

// 47.3, 47.16 — `:memory:` is a database of its own wherever it is opened, under test as well, so
// closing it is how a test starts on an empty one. THE REVERT: send `:memory:` through 47.4's scratch
// path; the reopened database still holds the car.
test('under bun test `:memory:` stays in memory, and close hands back an empty one — 47.3, 47.16', () => {
    const forks = database(':memory:', { migrations: [CARS] })
    forks().run("INSERT INTO cars (vin) VALUES ('1G1YB')")
    forks.close({ remove: true })
    expect({
        file: forks().filename,
        cars: forks().query('SELECT COUNT(*) AS cars FROM cars').get(),
    }).toEqual({ file: ':memory:', cars: { cars: 0 } })
    forks.close()
})

// 47.14 — THE REVERT: drop `strict` from the options `open` hands `new Database`; a missing `$vin`
// binds NULL, and what throws is the NOT NULL column rather than the binding.
test('strict, readonly and safeIntegers reach bun:sqlite — 47.14', () => {
    onDisk()
    const garage = database('garage', { migrations: [CARS], strict: true })
    garage().query('INSERT INTO cars (vin) VALUES ($vin)').run({ vin: '1G1YB' })
    expect(() =>
        garage()
            .query('INSERT INTO cars (vin) VALUES ($vin)')
            .run({ make: 'Chevrolet' } as never),
    ).toThrow('Missing parameter "vin"')
    garage.close()
    const reading = database('garage', {
        migrations: [CARS],
        readonly: true,
        safeIntegers: true,
    })
    expect(reading().query('SELECT id, vin FROM cars').all()).toEqual([
        { id: 1n, vin: '1G1YB' },
    ])
    expect(() => reading().run("INSERT INTO cars (vin) VALUES ('2')")).toThrow(
        'attempt to write a readonly database',
    )
    reading.close()
})

// 47.18 — THE REVERT: drop the early return for a current file in `open`; the readonly open writes
// `user_version` and throws 47.7.
test('a file whose migrations have all run is not written as it opens — 47.18', () => {
    onDisk()
    database('garage', { migrations: [CARS] })().close()
    const before = Bun.file(`${directory}/garage.sqlite`).lastModified
    const reading = database('garage', { migrations: [CARS], readonly: true })
    expect(versionOf(reading())).toBe(1)
    expect(Bun.file(`${directory}/garage.sqlite`).lastModified).toBe(before)
    reading.close()
})

// 47.15 — THE REVERT: drop the `open` call; `synchronous` reads FULL (2), and the hook saw nothing.
// Or call it after the migrations; it sees `user_version` 1, not 0.
test('open runs at every open, after the pragmas and before the migrations — 47.15', () => {
    onDisk()
    const seen: { journal: unknown; version: number }[] = []
    const garage = database('garage', {
        migrations: [CARS],
        open: (db) => {
            db.run('PRAGMA synchronous = NORMAL')
            seen.push({
                journal: db.query('PRAGMA journal_mode').get(),
                version: versionOf(db),
            })
        },
    })
    const synchronous = garage().query('PRAGMA synchronous').get()
    garage.close()
    garage()
    expect({ synchronous, seen }).toEqual({
        synchronous: { synchronous: 1 },
        seen: [
            { journal: { journal_mode: 'wal' }, version: 0 },
            { journal: { journal_mode: 'wal' }, version: 1 },
        ],
    })
    garage.close()
})

// 47.20 — A SEED BUILT FROM THE APP'S OWN HELPERS: `insertCar` calls the opener, which is still
// opening as the migration calling it runs. THE REVERT: drop `if (migrating !== undefined) return
// migrating` from the opener; the call throws 47.21's error, and the boot throws migration 2's 47.7.
// With 47.21's throw dropped too, the call opens a second connection that waits out the 5000 ms busy
// timeout on this one's write lock — the same migration 2, after 5.2 s.
test('a migration that calls a helper calling the opener seeds through the Database it migrates, inside its transaction — 47.20', () => {
    onDisk()
    let broken = true
    let seeding: Database | undefined
    const garage = database('garage', {
        migrations: [
            CARS,
            (db) => {
                seeding = db
                insertCar('1G1YB')
                insertCar('1G1YC')
            },
            () => {
                if (broken) throw new Error('no such car')
            },
        ],
    })
    const insertCar = (vin: string): void => {
        garage().run('INSERT INTO cars (vin) VALUES (?)', [vin])
    }
    expect(() => garage()).toThrow(
        'abide: database "garage"\'s migration 3 threw, and the database stays at migration 0. RULEBOOK 47.7.',
    )
    const after = new Database(`${directory}/garage.sqlite`)
    const rolledBack = {
        version: versionOf(after),
        tables: after
            .query("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all(),
    }
    after.close()
    broken = false
    const db = garage()
    expect({
        rolledBack,
        same: seeding === db,
        version: versionOf(db),
        cars: db.query('SELECT vin FROM cars ORDER BY id').all(),
    }).toEqual({
        rolledBack: { version: 0, tables: [] },
        same: true,
        version: 3,
        cars: [{ vin: '1G1YB' }, { vin: '1G1YC' }],
    })
    garage.close()
})

// 47.21 — a call from `open` or from the file function cannot be served: the `Database` is not
// migrated yet, or not opened at all. THE REVERT: drop the `opening` throw from the opener; each
// call opens again, which calls `open` or the function again, and both read `Maximum call stack size
// exceeded.` in place of 47.21's error.
test('an opener called from its own open hook or file function throws rather than open again — 47.21', () => {
    onDisk()
    const refused =
        'abide: a database opener was called while it opens, outside a migration — from its file function or its open hook. RULEBOOK 47.21.'
    const hooked = database('garage', {
        migrations: [CARS],
        open: () => {
            hooked()
        },
    })
    const named = database(() => {
        named()
        return 'garage'
    })
    const thrown = (opener: () => Database): unknown => {
        try {
            opener()
        } catch (error) {
            return error instanceof Error ? error.message : error
        }
        return 'opened'
    }
    expect({ hooked: thrown(hooked), named: thrown(named) }).toEqual({
        hooked: refused,
        named: refused,
    })
})

// 47.12 — A PATH IS READ AS THE FILE OPENS AND AT NO OTHER CALL, so a changed config takes effect at
// the next open, which `close` asks for. THE REVERT: call the function at every call and reopen where
// it changed; the second call answers `second.sqlite`.
test('a changed path opens at the next open, not the next call — 47.12', () => {
    onDisk()
    let named = `${directory}/first.sqlite`
    const garage = database(() => named, { migrations: [CARS] })
    const first = garage().filename
    named = `${directory}/second.sqlite`
    const still = garage().filename
    garage.close()
    expect({ first, still, next: garage().filename }).toEqual({
        first: `${directory}/first.sqlite`,
        still: `${directory}/first.sqlite`,
        next: `${directory}/second.sqlite`,
    })
    garage.close()
})

// 47.4 — ONE PROCESS, TWO TEST FILES, ONE OPENER: `bun test` without `--isolate` shares the module
// that made the opener between the files, and each still opens on an empty database. A child process,
// because the gate's `--parallel` isolates every file and could not show it. THE REVERT: drop the
// `scratchFor !== Bun.main` reopen in `database`; the second file reads 2 cars. 47.19 — THE REVERT:
// drop the sweep in `scratchDirectory`; the directory a finished process left is still there.
test("under bun test each test file opens a scratch database of its own, and a finished run's is removed — 47.4, 47.19", async () => {
    const counted = (file: string) => `import { expect, test } from 'bun:test'
import { garage } from './garage.ts'

test('${file}', () => {
    garage().run("INSERT INTO cars (vin) VALUES ('${file}')")
    const { cars } = garage().query('SELECT COUNT(*) AS cars FROM cars').get() as { cars: number }
    console.log('${file} reads ' + cars + ' cars')
    expect(cars).toBe(1)
})
`
    const fresh = temporaryModule({
        'garage.ts': `import { database } from '@abide/abide/server'

export const garage = database('garage', { migrations: [${JSON.stringify(CARS)}] })
`,
        'one.test.ts': counted('one'),
        'two.test.ts': counted('two'),
    })
    const finished = await spawned(['bun', '-e', 'console.log(process.pid)'])
    const left = `${(Bun.env.TMPDIR ?? '/tmp').replace(/\/$/, '')}/abide-test-${finished.stdout.trim()}-left`
    mkdirSync(left, { recursive: true })
    const ran = await spawned(
        ['bun', 'test', './one.test.ts', './two.test.ts'],
        {
            cwd: fresh,
        },
    )
    expect({
        ran: `${ran.exitCode} ${ran.stdout.match(/\w+ reads \d+ cars/g)?.join(', ')}`,
        left: existsSync(left),
    }).toEqual({ ran: '0 one reads 1 cars, two reads 1 cars', left: false })
}, 30_000)

// 47.10 — THE REVERT: drop the `onStop` from `database`; the handle survives the stop and the read
// after it answers.
test('stopping the app closes the database, and the next call opens it again — 47.10, 47.11', async () => {
    onDisk()
    const garage = database('garage', { migrations: [CARS] })
    const before = garage()
    before.run("INSERT INTO cars (vin) VALUES ('1G1YB')")
    const app = await inMemoryApp({})
    await app.stop()
    expect(() => before.query('SELECT 1').get()).toThrow()
    const after = garage()
    expect(after).not.toBe(before)
    expect(after.query('SELECT vin FROM cars').all()).toEqual([
        { vin: '1G1YB' },
    ])
    after.close()
})

// 8.41, 47.10 — THE STORE OUTLIVES THE `Database` A STOP CLOSES, which is every store an app files
// beside `database`'s opener and boots twice in one process. THE REVERT: call the function once in
// `store.sqlite` and keep what it handed back; the `get` after the stop throws `Cannot use a closed
// database`.
test('store.sqlite given an opener keeps working after the app stop closes its Database — 8.41, 47.10', async () => {
    onDisk()
    const crm = database('crm')
    const kept = sqlite<number>(crm, 'target')
    kept.set(750_000, { ttl: Number.POSITIVE_INFINITY })
    const app = await inMemoryApp({})
    await app.stop()
    expect({
        read: kept.get(),
        again: reactive(0, { store: sqlite<number>(crm, 'target') })(),
    }).toEqual({ read: 750_000, again: 750_000 })
    crm.close()
})

// 8.42, 47.4, 47.5 — A STRING IS WHAT `database` READS IT AS, so under bun test it opens 47.4's
// scratch file with 47.5's pragmas. THE REVERT: open the string as `new Database(path, { create: true
// })`; the named file is written, and the opener of the same string reads no `abide_store` table.
test('store.sqlite given a string keeps the value in the database `database` opens for it — 8.42, 47.4', async () => {
    directory = `${(Bun.env.TMPDIR ?? '/tmp').replace(/\/$/, '')}/abide-store-${process.pid}`
    mkdirSync(directory, { recursive: true })
    const path = `${directory}/kept.sqlite`
    sqlite<number>(path, 'target').set(7, {
        ttl: Number.POSITIVE_INFINITY,
    })
    const same = database(path)
    let row: unknown
    try {
        row = same().query('SELECT value FROM abide_store').get()
    } catch (error) {
        row = (error as Error).message
    }
    expect({
        written: await Bun.file(path).exists(),
        row,
        journal: same().query('PRAGMA journal_mode').get(),
    }).toEqual({
        written: false,
        row: { value: '7' },
        journal: { journal_mode: 'wal' },
    })
    same.close({ remove: true })
})

// 47.3 — THE REVERT: drop the `typeof file !== 'string'` throw from `checked`; `undefined` passes
// `NAME` as its text and the opener opens `undefined.sqlite` under APP_DATA_DIR.
test('a file function that answers anything but a string is refused — 47.3', async () => {
    onDisk()
    const unconfigured = database(() => undefined as unknown as string)
    const thrown = (): string => {
        try {
            return `opened ${unconfigured().filename}`
        } catch (error) {
            return (error as Error).message
        }
    }
    expect({
        thrown: thrown(),
        written: await Bun.file(`${directory}/undefined.sqlite`).exists(),
    }).toEqual({
        thrown: 'abide: database undefined is not a string, so names no file. RULEBOOK 47.3.',
        written: false,
    })
})

// 47.17, 47.10 — A TEST'S `await using app` HAS CLOSED THE FILE BY THE TIME IT REMOVES IT. THE REVERT:
// remove `opened?.filename` in `close`, as 47.17 once read; the stop left nothing open, so nothing is
// removed, and the next call reads the car.
test('close with remove deletes the file the opener last opened, after the app stop closed it — 47.17, 47.10', async () => {
    const garage = database('removed', { migrations: [CARS] })
    const file = garage().filename
    garage().run("INSERT INTO cars (vin) VALUES ('1G1YB')")
    const app = await inMemoryApp({})
    await app.stop()
    garage.close({ remove: true })
    const left: Record<string, boolean> = {}
    for (const suffix of ['', '-wal', '-shm'])
        left[suffix] = await Bun.file(`${file}${suffix}`).exists()
    expect({
        left,
        cars: garage().query('SELECT COUNT(*) AS cars FROM cars').get(),
    }).toEqual({
        left: { '': false, '-wal': false, '-shm': false },
        cars: { cars: 0 },
    })
    garage.close({ remove: true })
})
