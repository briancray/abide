// 47.32-47.35 — SQL AS A TAG, AND A TABLE CALLED: every interpolation a bound parameter, one statement
// per call site, and a run that read a table refreshed when that table changes — whoever changed it —
// with no tag written to say so.

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'

import { database, table } from '#server'
import { flushSync, memo, reactive, watch } from '#shared'
import { keyedValue } from '#shared/reactive/index.ts'

type Deal = { id: string; stage: string; amount: number }

let opened = 0

/** A fresh database file with deals and contacts, and a view over the won deals. */
function crm() {
    opened += 1
    const db = database(`sql-${opened}`, {
        migrations: [
            'CREATE TABLE deals (id TEXT PRIMARY KEY, stage TEXT NOT NULL, amount INTEGER NOT NULL)',
            'CREATE TABLE contacts (id TEXT PRIMARY KEY, name TEXT NOT NULL)',
            "CREATE VIEW won AS SELECT * FROM deals WHERE stage = 'won'",
            "INSERT INTO deals VALUES ('d1', 'won', 100), ('d2', 'lead', 40)",
            "INSERT INTO contacts VALUES ('c1', 'Ada')",
        ],
    })
    return db
}

/** Subscribes to `read`, counting the runs `body` makes; `stop` lets go. */
function followed<Value>(body: () => Value) {
    let runs = 0
    const entry = keyedValue(() => {
        runs += 1
        return body()
    })()
    let seen: unknown
    const stop = watch(() => {
        seen = entry()
    })
    flushSync()
    return {
        runs: () => runs,
        seen: () => seen,
        stop,
    }
}

/** Waits for `done`, with a deadline, rather than sleeping a fixed time. */
async function until(done: () => boolean): Promise<void> {
    const deadline = Date.now() + 2_000
    while (!done() && Date.now() < deadline) await Bun.sleep(10)
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
        if (!text.startsWith('EXPLAIN')) prepared += 1
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

// 47.32 — WHAT A RUN READ, FROM WHAT SQLITE COMPILED: a read through a view, joined, refreshed by a
// commit another connection makes to the table under it. THE REVERT: drop `readTables` from `sqlOver`;
// the total stands at `100`.
test('a run reading through sql is refreshed by a commit to a table it read — 47.32', async () => {
    const db = crm()
    const total = followed(
        () =>
            db.sql<{
                total: number
            }>`SELECT SUM(won.amount) AS total FROM won JOIN contacts ON contacts.id = 'c1'`[0]
                ?.total,
    )
    expect(`total: ${total.seen()}`).toBe('total: 100')
    const other = new Database(db().filename)
    other.run("UPDATE deals SET stage = 'won' WHERE id = 'd2'")
    other.close()
    await until(() => total.seen() === 140)
    total.stop()
    expect(`total: ${total.seen()}`).toBe('total: 140')
})

// 47.32 — A RUN THAT NO LONGER READS A TABLE IS NOT ITS READER: the second run read no table at all.
// THE REVERT: drop the `runEpoch` check in `changed`; a write to deals runs it again, `runs: 3` where
// `runs: 2` is due.
test("a change to a table a value's last run did not read refreshes nothing — 47.32", async () => {
    const db = crm()
    let readDeals = true
    const counted = followed(() =>
        readDeals ? db.sql`SELECT COUNT(*) AS n FROM deals` : [],
    )
    readDeals = false
    db.sql`INSERT INTO deals VALUES ('d3', 'lead', 5)`
    await until(() => counted.runs() === 2)
    db.sql`INSERT INTO deals VALUES ('d4', 'lead', 5)`
    await Bun.sleep(150)
    counted.stop()
    expect(`runs: ${counted.runs()}`).toBe('runs: 2')
})

// 47.34 — A TURN'S WRITES THROUGH sql ARE ONE REFRESH, and the watch does not hear them again. THE
// REVERT: drop the `watch.seen` update in `wroteTables`'s flush; the watch refreshes it once more,
// `runs: 3` where `runs: 2` is due.
test("a turn's writes through sql refresh each reader once — 47.34", async () => {
    const db = crm()
    const counted = followed(
        () => db.sql<{ n: number }>`SELECT COUNT(*) AS n FROM deals`[0]?.n,
    )
    for (const id of ['d3', 'd4', 'd5'])
        db.sql`INSERT INTO deals VALUES (${id}, 'lead', 1)`
    await until(() => counted.seen() === 5)
    await Bun.sleep(150)
    counted.stop()
    expect(`n: ${counted.seen()} runs: ${counted.runs()}`).toBe('n: 5 runs: 2')
})

// 47.33 — A RUN THAT WRITES A TABLE IS NO READER OF IT: a body that logs its visit and reads the log
// would refresh itself for ever. THE REVERT: drop `reads.delete` in `sql.ts`'s `prepare` and the `wrote`
// check in `readTables`; it runs again on its own write, and again, past `runs: 1`.
test('a run that writes a table through sql is not refreshed by it — 47.33', async () => {
    const db = crm()
    const visits = followed(() => {
        db.sql`INSERT INTO contacts VALUES (${crypto.randomUUID()}, 'visit')`
        return db.sql<{ n: number }>`SELECT COUNT(*) AS n FROM contacts`[0]?.n
    })
    await Bun.sleep(200)
    visits.stop()
    expect(`runs: ${visits.runs()}`).toBe('runs: 1')
})

// 47.35 — A TABLE CALLED IS ITS ROWS, or those a match names; and its read is tracked as sql's is.
// THE REVERT: drop `readTables` from the table's `read`; the won deals stand at `d1`.
test('a table called answers its rows by equality, and refreshes its reader — 47.35', async () => {
    const db = crm()
    const deals = table<Deal>(db, 'deals')
    expect(deals().length).toBe(2)
    expect(deals({ stage: 'won', amount: 100 }).map((deal) => deal.id)).toEqual(
        ['d1'],
    )
    let refused = ''
    try {
        deals({ nope: 1 } as never)
    } catch (thrown) {
        refused = (thrown as Error).message
    }
    expect(refused).toContain('RULEBOOK 47.35')
    const won = followed(() =>
        deals({ stage: 'won' })
            .map((deal) => deal.id)
            .join(),
    )
    db.sql`UPDATE deals SET stage = 'won' WHERE id = 'd2'`
    await until(() => won.seen() === 'd1,d2')
    won.stop()
    expect(`won: ${won.seen()}`).toBe('won: d1,d2')
})

// 47.32 — A MEMO'S ENTRY, read through `reactive.derived`, is a run like any other: its answer moves
// with the table, per key, with no tag. THE REVERT: drop `readTables` from `sqlOver`; the won entry
// stands at `100`.
test('a memo entry reading through sql follows the table — 47.32', async () => {
    const db = crm()
    const totals = memo(
        ({ stage }: { stage: string }) =>
            db.sql<{
                total: number
            }>`SELECT SUM(amount) AS total FROM deals WHERE stage = ${stage}`[0]
                ?.total,
    )
    const won = reactive.derived(() => totals({ stage: 'won' }))
    let seen: unknown
    const stop = watch(() => {
        seen = won()
    })
    await until(() => seen === 100)
    db.sql`UPDATE deals SET stage = 'won' WHERE id = 'd2'`
    await until(() => seen === 140)
    stop()
    expect(`won: ${seen}`).toBe('won: 140')
})
