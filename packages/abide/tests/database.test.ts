// `database` (RULEBOOK 47). The claims are about the FILE: what it holds after a boot, and after a
// second boot over it — so most tests here open a real file under a temporary `APP_DATA_DIR`, with
// `NODE_ENV` moved off `test` for the length of the test, which is 47.4's scratch otherwise.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, test } from 'bun:test'

import { config } from '#server/config.ts'
import { database } from '#server/database.ts'
import { sqliteStore } from '#server/sqliteStore.ts'
import { reactive } from '#shared'

import { inMemoryApp } from './inMemoryApp.ts'

const environmentAsFound = process.env.NODE_ENV
const dataDirectoryAsFound = process.env.APP_DATA_DIR
let directory = ''
let counter = 0

// A directory of its own per test, so no test reads a file another wrote.
function onDisk(): void {
    counter += 1
    directory = `${Bun.env.TMPDIR ?? '/tmp'}/abide-database-${process.pid}-${counter}`
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

test('a name that is not a file name is refused — 47.3', () => {
    for (const name of ['../garage', 'cars/garage', '.garage', ''])
        expect(() => database(name)).toThrow(
            `abide: database ${JSON.stringify(name)} is not a file name. RULEBOOK 47.3.`,
        )
})

// 47.4 — THE REVERT: drop the `NODE_ENV` test from `fileOf`; the two openers share the file and the
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
