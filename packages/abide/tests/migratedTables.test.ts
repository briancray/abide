// 47.47-47.49 — A DATABASE'S TABLES TYPED FROM ITS MIGRATIONS: the checker folds every `CREATE TABLE`,
// `ALTER TABLE` and `DROP TABLE` in order, and a `table` of the opener is typed by what they leave.
// These are the checker's tests: `bun run typecheck` is what fails them, and the runtime half only
// proves the rows read match the types claimed.

import { expect, test } from 'bun:test'

import { database, table, type Tables } from '#server'

/** True where `One` and `Other` are the same type, and a type error at the assertion where not. */
type Same<One, Other> =
    (<Probe>() => Probe extends One ? 1 : 2) extends <
        Probe,
    >() => Probe extends Other ? 1 : 2
        ? true
        : false
const same = <Check extends true>(): Check => true as Check

const CRM = database('migrated-tables', {
    migrations: [
        `CREATE TABLE deals (
            id INTEGER PRIMARY KEY,
            "name" TEXT NOT NULL,
            amount REAL NOT NULL DEFAULT (0.0),
            stage VARCHAR(20) CHECK (stage IN ('lead', 'won', 'lost')),
            won BOOLEAN NOT NULL DEFAULT false,
            notes JSON,
            createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            companyId INTEGER REFERENCES companies(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY NOT NULL, name TEXT);
         CREATE TABLE stale (id INTEGER PRIMARY KEY);
         CREATE TABLE tags (dealId INTEGER NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (dealId, tag))`,
        'ALTER TABLE deals ADD COLUMN closedAt TEXT',
        'ALTER TABLE deals RENAME COLUMN notes TO detail',
        'ALTER TABLE companies DROP COLUMN name',
        "ALTER TABLE companies ADD COLUMN domain TEXT NOT NULL DEFAULT ''",
        'DROP TABLE IF EXISTS stale',
        'ALTER TABLE tags RENAME TO dealTags',
        `-- a comment; holding a semicolon, and CREATE TABLE ghost (id INTEGER)
        CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL) -- a trailing one
        ;
        CREATE VIRTUAL TABLE dealSearch USING fts5(name);
         CREATE TRIGGER deals_search AFTER INSERT ON deals BEGIN
             INSERT INTO dealSearch (rowid, name) VALUES (NEW.id, NEW.name);
         END`,
        (db) => db.run('CREATE TABLE seeded (id INTEGER PRIMARY KEY)'),
    ],
})

test('a table is typed by the migrations that declare it — 47.47, 47.48', () => {
    type Found = Tables<typeof CRM>
    same<
        Same<
            Found['deals'],
            {
                id: number
                name: string
                amount: number
                stage: string | null
                won: boolean
                detail: unknown
                createdAt: string
                companyId: number | null
                closedAt: string | null
            }
        >
    >()
    same<Same<Found['companies'], { id: string; domain: string }>>()
    same<Same<Found['dealTags'], { dealId: number; tag: string }>>()
    same<Same<keyof Found, 'deals' | 'companies' | 'dealTags' | 'notes'>>()
    same<Same<Found['notes'], { id: number; body: string }>>()
    const deals = table(CRM, 'deals')
    // A written row leaves out what may be NULL or has a default, never the key it is named by.
    deals.set({ id: 1, name: 'Acme', createdAt: '2026-11-27' })
    // Checked, never run: each is refused by the checker, and would throw if it ran.
    const refused = () => {
        // @ts-expect-error a written row carries its key
        deals.set({ name: 'Globex', createdAt: '2026-11-27' })
        // @ts-expect-error a table the migrations never declared
        table(CRM, 'stale')
    }
    void refused
    // An insert may leave out the key SQLite assigns.
    const [inserted] = table(CRM, 'notes').insert({ body: 'first' })
    expect(inserted).toEqual({ id: 1, body: 'first' })
    // Options keep the table typed, and name only its columns.
    const logged = table(CRM, 'deals', { logged: ['stage'] })
    same<Same<ReturnType<typeof logged.peek>[number]['stage'], string | null>>()
    const refusedLogged = () => {
        // @ts-expect-error logged names a column the table has
        table(CRM, 'deals', { logged: ['nope'] })
    }
    void refusedLogged
    // A column narrowed keeps the table's name, its written row and its inserted row.
    type Detail = { calls: number }
    const narrowed = table(CRM, 'deals').as<{
        detail: Detail | null
        stage: 'lead' | 'won' | null
    }>()
    const [fresh] = narrowed.insert({
        name: 'Initech',
        createdAt: '2026-11-28',
        detail: { calls: 4 },
    })
    same<Same<NonNullable<typeof fresh>['detail'], Detail | null>>()
    expect(fresh?.detail).toEqual({ calls: 4 })
    const refusedNarrowing = () => {
        // @ts-expect-error a narrowing is a type the column already admits
        table(CRM, 'deals').as<{ amount: string }>()
        // @ts-expect-error a narrowed table still writes only what its column narrows to
        narrowed.patch({ id: 1, stage: 'lost' })
    }
    void refusedNarrowing
    // A plain object binds in sql as its JSON (47.52), typed as one.
    CRM.sql`UPDATE deals SET detail = ${{ calls: 5 }} WHERE id = ${fresh?.id ?? 0}`
    expect(narrowed({ id: fresh?.id ?? 0 })[0]?.detail).toEqual({ calls: 5 })
    // A row typed by its caller may leave out what may hold null.
    table<{ id: number; detail: { calls: number } | null }>(CRM, 'deals').patch(
        { id: 1 },
    )
    // A table a function made is the caller's to type, as one of no typed opener is.
    const seeded = table<{ id: number }>(CRM, 'seeded')
    expect(seeded()).toEqual([])
    const [row] = deals({ id: 1 })
    expect(row).toEqual({
        id: 1,
        name: 'Acme',
        amount: 0,
        stage: null,
        won: false,
        detail: null,
        createdAt: '2026-11-27',
        companyId: null,
        closedAt: null,
    })
})

test('a string the checker sees only as a string types no table — 47.47', () => {
    const migration: string = 'CREATE TABLE notes (id INTEGER PRIMARY KEY)'
    const untyped = database('migrated-untyped', { migrations: [migration] })
    same<Same<Tables<typeof untyped>, never>>()
    const notes = table<{ id: number }>(untyped, 'notes')
    expect(notes()).toEqual([])
})
