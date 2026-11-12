// `database` (RULEBOOK 47). The claims are about the FILE: what it holds after a boot, and after a
// second boot over it — so most tests here open a real file under a temporary `APP_DATA_DIR`, with
// `NODE_ENV` moved off `test` for the length of the test, which is 47.4's scratch otherwise.

import { Database } from 'bun:sqlite'
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs' // bun exposes no directory creation of its own

import { spawned } from '@abide/harness/gate'

import { config } from '#server/config.ts'
import { database } from '#server/database.ts'
import { sqliteStore } from '#server/sqliteStore.ts'
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

// 47.3 — THE REVERT: open every string as `<name>.sqlite` in `pathOf`; the absolute path opens
// `garage.sqlite.sqlite` and the relative one throws 47.3.
test('a path opens that file, absolute as given and relative under APP_DATA_DIR — 47.2, 47.3', async () => {
    onDisk()
    const absolute = database(`${directory}/elsewhere/garage.sqlite`, {
        migrations: [CARS],
    })()
    const relative = database('data/garage.sqlite', { migrations: [CARS] })()
    expect({
        absolute: absolute.filename,
        relative: relative.filename,
        written: [
            await Bun.file(`${directory}/elsewhere/garage.sqlite`).exists(),
            await Bun.file(`${directory}/data/garage.sqlite`).exists(),
        ],
    }).toEqual({
        absolute: `${directory}/elsewhere/garage.sqlite`,
        relative: `${directory}/data/garage.sqlite`,
        written: [true, true],
    })
    absolute.close()
    relative.close()
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

// 47.12, 47.4 — THE REVERT: call the function under `NODE_ENV=test` too; it is called once.
test('under bun test the function is never called, and the scratch database wins over any path — 47.4, 47.12', () => {
    let calls = 0
    const garage = database(
        () => {
            calls += 1
            return '/nowhere/garage.sqlite'
        },
        { migrations: [CARS] },
    )
    const pathed = database('/nowhere/garage.sqlite', { migrations: [CARS] })
    const files = [garage().filename, pathed().filename]
    expect({ calls, files }).toEqual({
        calls: 0,
        files: [':memory:', ':memory:'],
    })
    garage().close()
    pathed().close()
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
    for (const name of ['.garage', '', 'cars\\garage', ':memory'])
        expect(() => database(name)).toThrow(
            `abide: database ${JSON.stringify(name)} is not a file name. RULEBOOK 47.3.`,
        )
    onDisk()
    expect(() => database(() => '.garage')()).toThrow(
        'abide: database ".garage" is not a file name. RULEBOOK 47.3.',
    )
})

// 47.4 — THE REVERT: open the named file under `NODE_ENV=test` too; the two openers share the file and the
// second reads the first's car.
test('under bun test each opener is a scratch database of its own, and no file is written — 47.4', async () => {
    directory = `${Bun.env.TMPDIR ?? '/tmp'}/abide-database-${process.pid}-scratch`
    process.env.APP_DATA_DIR = directory
    config.invalidate()
    const one = database('garage', { migrations: [CARS] })()
    one.run("INSERT INTO cars (vin) VALUES ('1G1YB')")
    const two = database('garage', { migrations: [CARS] })()
    expect({
        other: two.query('SELECT COUNT(*) AS cars FROM cars').get(),
        written: await Bun.file(`${directory}/garage.sqlite`).exists(),
    }).toEqual({ other: { cars: 0 }, written: false })
    one.close()
    two.close()
})

// 47.4 — ONE PROCESS, TWO TEST FILES, ONE OPENER: `bun test` without `--isolate` shares the module
// that made the opener between the files, and each still opens on an empty database. A child process,
// because the gate's `--parallel` isolates every file and could not show it. THE REVERT: drop the
// `scratchFor !== Bun.main` reopen in `database`; the second file reads 2 cars.
test('under bun test each test file opens a scratch database of its own — 47.4', async () => {
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
    const ran = await spawned(
        ['bun', 'test', './one.test.ts', './two.test.ts'],
        {
            cwd: fresh,
        },
    )
    expect(
        `${ran.exitCode} ${ran.stdout.match(/\w+ reads \d+ cars/g)?.join(', ')}`,
    ).toBe('0 one reads 1 cars, two reads 1 cars')
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

test('sqliteStore keeps a value in the database an opener hands back — 47.1, 8.25', () => {
    const db = database('crm')()
    const target = reactive(500_000, {
        store: sqliteStore<number>(db, 'target'),
    })
    target.set(750_000)
    expect(reactive(0, { store: sqliteStore<number>(db, 'target') })()).toBe(
        750_000,
    )
    db.close()
})
