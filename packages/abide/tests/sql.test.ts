// 47.29, 47.32-47.38 — SQL AS A TAG, A TABLE CALLED AND WRITTEN BY KEY: every interpolation a bound
// parameter, one statement per call site, a match as JSON — and what reads a table refreshed by the
// tag its name is, at once for a write through the table and on the watch's next look for any other.

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'

import { database, table } from '#server'
import { flushSync, memo, reactive, watch } from '#shared'

type Deal = { id: string; stage: string; amount: number }

let opened = 0

/** A fresh database file with deals and contacts. */
function crm() {
    opened += 1
    const db = database(`sql-${opened}`, {
        migrations: [
            'CREATE TABLE deals (id TEXT PRIMARY KEY, stage TEXT NOT NULL, amount INTEGER NOT NULL)',
            'CREATE TABLE contacts (id TEXT PRIMARY KEY, name TEXT NOT NULL)',
            "INSERT INTO deals VALUES ('d1', 'won', 100), ('d2', 'lead', 40)",
            "INSERT INTO contacts VALUES ('c1', 'Ada')",
        ],
    })
    return db
}

/** Waits for `done`, with a deadline, rather than sleeping a fixed time. */
async function until(done: () => boolean): Promise<void> {
    const deadline = Date.now() + 2_000
    while (!done() && Date.now() < deadline) await Bun.sleep(10)
}

/** A global memo totalling the deals through `sql`, tagged with the table, followed by a watch. */
function wonTotal(db: ReturnType<typeof crm>) {
    let runs = 0
    const total = memo(
        () => {
            runs += 1
            return (
                db.sql<{
                    total: number
                }>`SELECT SUM(amount) AS total FROM deals WHERE stage = 'won'`[0]
                    ?.total ?? 0
            )
        },
        { global: true, tags: ['deals'] },
    )
    const read = reactive.derived(() => total())
    let seen: unknown
    const stop = watch(() => {
        try {
            seen = read()
        } catch {}
    })
    flushSync()
    return { runs: () => runs, seen: () => seen, stop }
}

// 47.32 — A VALUE IS NEVER TEXT. THE REVERT: splice each value into the text in `sqlOver`; the quote
// ends the literal and the statement fails, `refused` where the value itself is due.
test('sql binds every interpolated value as a parameter — 47.32', () => {
    const db = crm()
    const sneaky = "x' OR '1'='1"
    let answered: string
    try {
        const rows = db.sql<{
            id: string
        }>`SELECT id FROM deals WHERE id = ${sneaky}`
        answered = `rows: ${rows.length}`
    } catch {
        answered = 'refused'
    }
    expect(answered).toBe('rows: 0')
    const echoed = db.sql<{ v: string }>`SELECT ${sneaky} AS v`
    expect(echoed[0]?.v).toBe(sneaky)
})

// 47.32 — ONE STATEMENT PER CALL SITE. THE REVERT: drop the `PREPARED` lookup in `sqlOver`; the loop
// prepares 3 where 1 is due.
test('sql prepares one statement per call site — 47.32', () => {
    const db = crm()
    const connection = db()
    const prepare = connection.prepare.bind(connection)
    let prepared = 0
    connection.prepare = ((text: string) => {
        prepared += 1
        return prepare(text)
    }) as typeof connection.prepare
    const amounts: number[] = []
    for (const id of ['d1', 'd2', 'd1'])
        amounts.push(
            db.sql<{
                amount: number
            }>`SELECT amount FROM deals WHERE id = ${id}`[0]?.amount as number,
        )
    expect(`${amounts.join()} prepared: ${prepared}`).toBe(
        '100,40,100 prepared: 1',
    )
})

// 47.29, 47.34 — A WRITE THROUGH THE TABLE REFRESHES ITS TAG AT ONCE, the watch's next look not
// hearing it again. THE REVERT: drop the `heard` call in the table's `wrote`; the total is still `100`
// on the turn after the write, where `105` is due, and reaches it only on the watch's next look.
test("a table's write refreshes what carries its name as a tag at once — 47.29, 47.34", async () => {
    const db = crm()
    const deals = table<Deal>(db, 'deals')
    const won = wonTotal(db)
    await until(() => won.seen() === 100)
    // Past the watch's first look, so the runs counted are the write's alone.
    await Bun.sleep(120)
    const before = won.runs()
    deals.set({ id: 'd3', stage: 'won', amount: 5 })
    await Bun.sleep(0)
    await Bun.sleep(0)
    const atOnce = won.seen()
    await Bun.sleep(150)
    won.stop()
    expect(`${atOnce} runs: ${won.runs() - before}`).toBe('105 runs: 1')
})

// 47.29 — A COMMIT ANOTHER CONNECTION MAKES REFRESHES THE TAG on the watch's next look: the change log
// is written by the table's triggers, whoever wrote. THE REVERT: drop `invalidate` from `changed`; the
// total stands at `100`.
test('a commit by another connection refreshes what carries the table as a tag — 47.29', async () => {
    const db = crm()
    table<Deal>(db, 'deals')
    const won = wonTotal(db)
    await until(() => won.seen() === 100)
    const other = new Database(db().filename)
    other.run("INSERT INTO deals VALUES ('d4', 'won', 40)")
    other.close()
    await until(() => won.seen() === 140)
    won.stop()
    expect(won.seen()).toBe(140)
})

// 47.33 — A TABLE IS WRITTEN BY KEY: `set` upserts, `patch` writes only the columns a row names, and
// `delete` removes what a match names, answering how many. A row without its key, and a delete naming
// no column, are refused. THE REVERT: write `patch` through `upsert`; the patched row's `amount` is
// refused NOT NULL where `d2:won:40` is due.
test('a table is set, patched and deleted by key — 47.33', () => {
    const db = crm()
    const deals = table<Deal>(db, 'deals')
    deals.set([
        { id: 'd3', stage: 'lead', amount: 7 },
        { id: 'd1', stage: 'won', amount: 110 },
    ])
    deals.patch({ id: 'd2', stage: 'won' })
    const removed = deals.delete({ id: ['d3'] })
    expect(
        db.sql<Deal>`SELECT * FROM deals ORDER BY id`
            .map((row) => `${row.id}:${row.stage}:${row.amount}`)
            .join(),
    ).toBe('d1:won:110,d2:won:40')
    expect(removed).toBe(1)
    const refusals: string[] = []
    for (const write of [
        () => deals.set({ stage: 'won', amount: 1 } as never),
        () => deals.patch({ stage: 'won' } as never),
        () => deals.delete({}),
    ])
        try {
            write()
        } catch (thrown) {
            refusals.push(
                (thrown as Error).message.includes('RULEBOOK 47.33')
                    ? 'refused'
                    : String(thrown),
            )
        }
    expect(refusals).toEqual(['refused', 'refused', 'refused'])
})

/** The ids `rows` holds, in id order. */
const idsOf = (rows: { id: string }[]): string =>
    rows
        .map((row) => row.id)
        .sort()
        .join()

/** A database whose deals cover a NULL stage, for the JSON match. */
function pipeline() {
    opened += 1
    return database(`sql-${opened}`, {
        migrations: [
            'CREATE TABLE deals (id TEXT PRIMARY KEY, stage TEXT, amount INTEGER NOT NULL)',
            "INSERT INTO deals VALUES ('d1', 'won', 100), ('d2', 'lead', 40), ('d3', NULL, 70), ('d4', 'lost', 10)",
        ],
    })
}

// 47.36 — A MATCH IS JSON: a list is one of its values, an object comparisons met together, and both
// as JSON reads them about `null` — a list holding it matches a NULL, and `ne` refuses no NULL it was
// not given. THE REVERT: have `conditionOf` treat every value as `= ?`; the first list throws
// `expected 1 values, received 2` where `d1,d2` is due.
test('a table called matches a list, comparisons and null as JSON reads them — 47.36', () => {
    const deals = table<{ id: string; stage: string | null; amount: number }>(
        pipeline(),
        'deals',
    )
    const answers = [
        idsOf(deals({ stage: ['won', 'lead'] })),
        idsOf(deals({ stage: ['won', null] })),
        idsOf(deals({ stage: [] })),
        idsOf(deals({ amount: { gte: 40, lt: 100 } })),
        idsOf(deals({ stage: { ne: 'won' } })),
        idsOf(deals({ stage: { ne: null } })),
        idsOf(deals({ amount: {} })),
    ]
    expect(answers).toEqual([
        'd1,d2',
        'd1,d3',
        '',
        'd2,d3',
        'd2,d3,d4',
        'd1,d2,d4',
        'd1,d2,d3,d4',
    ])
    const refusals: string[] = []
    for (const match of [
        { amount: { like: 4 } },
        { amount: { gt: null } },
        { amount: [[40]] },
    ])
        try {
            deals(match as never)
        } catch (thrown) {
            refusals.push(
                (thrown as Error).message.includes('RULEBOOK 47.36')
                    ? 'refused'
                    : 'other',
            )
        }
    expect(refusals).toEqual(['refused', 'refused', 'refused'])
})

// 47.37 — A LIST INTERPOLATED IS A LIST BOUND, one statement per call site per length: two lists of
// two prepare once, and a list of three once more. An empty list is no row, so `IN` matches nothing
// and `NOT IN` everything. THE REVERT: drop the lengths from the cache key in `sqlOver`; the list of
// three meets the two-slot statement and throws `expected 2 values, received 3` where `d1,d2,d3` is due.
test('sql binds a list interpolated as one, a statement per length — 47.37', () => {
    const db = pipeline()
    const connection = db()
    const prepare = connection.prepare.bind(connection)
    let prepared = 0
    connection.prepare = ((text: string) => {
        prepared += 1
        return prepare(text)
    }) as typeof connection.prepare
    const among = (ids: string[]) =>
        db.sql<{ id: string }>`SELECT id FROM deals WHERE id IN ${ids}`
    const outside = (ids: string[]) =>
        db.sql<{ id: string }>`SELECT id FROM deals WHERE id NOT IN ${ids}`
    const answers = [
        idsOf(among(['d1', 'd2'])),
        idsOf(among(['d3', 'd4'])),
        idsOf(among(['d1', 'd2', 'd3'])),
        idsOf(among([])),
        idsOf(outside([])),
    ]
    expect(`${answers.join(' | ')} prepared: ${prepared}`).toBe(
        'd1,d2 | d3,d4 | d1,d2,d3 |  | d1,d2,d3,d4 prepared: 4',
    )
})

// 47.38 — A DATABASE THAT REFUSES THE CHANGE LOG IS STILL READ: opened read-only, a table called and
// a statement through `sql` both answer, and its stopped watch is said once for the database rather
// than once per table. THE REVERT: read a called table on the connection that makes the change log
// (`selects<Row>(connection, name)`); the call throws `attempt to write a readonly database`. AND
// drop `WARNED`; the two tables say it `said: 2`.
test('a read-only database is read, its stopped watch said once — 47.38', async () => {
    opened += 1
    const name = `sql-${opened}`
    const migrations = [
        'CREATE TABLE deals (id TEXT PRIMARY KEY, stage TEXT)',
        'CREATE TABLE contacts (id TEXT PRIMARY KEY)',
        "INSERT INTO deals VALUES ('d1', 'won')",
    ]
    database(name, { migrations })()
    const readOnly = database(name, { readonly: true, migrations })
    const warn = console.warn
    let said = 0
    console.warn = (...args: unknown[]) => {
        if (String(args[0]).includes('RULEBOOK 47.38')) said += 1
    }
    try {
        const deals = table<{ id: string; stage: string }>(readOnly, 'deals')
        table<{ id: string }>(readOnly, 'contacts')
        const answered = idsOf(deals({ stage: 'won' }))
        const n = readOnly.sql<{
            n: number
        }>`SELECT (SELECT COUNT(*) FROM deals) + (SELECT COUNT(*) FROM contacts) AS n`[0]
            ?.n
        await until(() => said > 0)
        await Bun.sleep(120)
        expect(`${answered} n: ${n} said: ${said}`).toBe('d1 n: 1 said: 1')
    } finally {
        console.warn = warn
    }
})
