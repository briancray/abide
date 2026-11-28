// 47.22-47.28 — A TABLE AS A STREAM PAIR: every committed change read out in order, whoever wrote it,
// none for a write rolled back; rows written in upserted a turn at a time; and a change refreshing
// the table's `rpc` alone.

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'

import { type Change, rpc, table } from '#server'
import { flushSync, reactive, watch } from '#shared'
import { keyedValue } from '#shared/reactive/index.ts'

type Deal = { id: string; name: string; amount: number }

function deals(): Database {
    const db = new Database(':memory:')
    db.run(
        'CREATE TABLE deals (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount INTEGER NOT NULL)',
    )
    return db
}

/** Waits for `done`, with a deadline, rather than sleeping a fixed time. */
async function until(done: () => boolean): Promise<void> {
    const deadline = Date.now() + 2_000
    while (!done() && Date.now() < deadline) await Bun.sleep(10)
}

/** The first `count` changes `stream` hands on, then the stream let go. */
async function taken<Row>(
    stream: ReadableStream<Change<Row>>,
    count: number,
): Promise<Change<Row>[]> {
    const reader = stream.getReader()
    const out: Change<Row>[] = []
    while (out.length < count) {
        const { value, done } = await reader.read()
        if (done) break
        out.push(value)
    }
    await reader.cancel()
    return out
}

// 47.22 — A TABLE THE DATABASE DOES NOT HOLD IS REFUSED where it is first reached. THE REVERT: drop the
// column check in `prepare`, and the triggers are made over nothing.
test('table refuses a table the database does not hold — 47.22', () => {
    let said = 'built'
    try {
        void table(new Database(':memory:'), 'missing').writable
    } catch (thrown) {
        said = (thrown as Error).message.includes('47.22') ? 'refused' : 'other'
    }
    expect(said).toBe('refused')
})

// 47.36 — A TABLE DECLARED OPENS NOTHING, so a module declaring one at import time opens its database
// only once the app's config names where. THE REVERT: stand the table's watch up in `table` itself
// rather than at its first call or write; the opener is called at the declaration, 1 open where 0
// are due.
test('a table declared does not open its database until it is called — 47.36', () => {
    const db = deals()
    let opens = 0
    const opener = () => {
        opens += 1
        return db
    }
    const pair = table<Deal>(opener, 'deals')
    expect(`opens: ${opens}`).toBe('opens: 0')
    expect(pair()).toEqual([])
    expect(opens).toBeGreaterThan(0)
})

// 47.23, 47.24, 47.25 — EVERY COMMITTED WRITE, BY ANY STATEMENT, IS ONE CHANGE, IN ORDER; ONE ROLLED
// BACK IS NONE. The writes here are raw SQL, not the pair's: the triggers are what capture them.
// THE REVERT: capture in the pair's writable alone, and nothing raw SQL wrote is read.
test('a table reads every committed change in order, and none rolled back — 47.23, 47.24, 47.25', async () => {
    const db = deals()
    const pair = table<Deal>(db, 'deals')
    const reading = taken(pair.readable, 3)
    db.run("INSERT INTO deals VALUES ('d1', 'Acme', 100)")
    try {
        db.transaction(() => {
            db.run("INSERT INTO deals VALUES ('d2', 'Globex', 200)")
            throw new Error('rolled back')
        })()
    } catch {}
    db.run("UPDATE deals SET amount = 150 WHERE id = 'd1'")
    db.run("DELETE FROM deals WHERE id = 'd1'")
    const changes = await reading
    expect(
        changes.map(
            (change) =>
                `${change.op} ${change.row?.amount ?? '-'} was ${change.previous?.amount ?? '-'}`,
        ),
    ).toEqual(['insert 100 was -', 'update 150 was 100', 'delete - was 150'])
})

// 47.27 — ROWS WRITTEN ARE UPSERTED BY KEY, A TURN'S WRITES ONE TRANSACTION. Counted as the
// transactions the database begins. THE REVERT: commit each write as it comes, and `commits: 3`.
test('rows written are upserted by key, a turn of writes in one transaction — 47.27', async () => {
    const db = deals()
    const writable = table<Deal>(db, 'deals').writable
    let commits = 0
    const begin = db.transaction.bind(db)
    db.transaction = ((run: (...given: never[]) => unknown) => {
        const wrapped = begin(run)
        return ((...given: never[]) => {
            commits += 1
            return wrapped(...given)
        }) as never
    }) as typeof db.transaction
    const writer = writable.getWriter()
    void writer.write({ id: 'd1', name: 'Acme', amount: 100 })
    void writer.write({ id: 'd2', name: 'Globex', amount: 200 })
    void writer.write({ id: 'd1', name: 'Acme', amount: 120 })
    await writer.close()
    const rows = db.query('SELECT id, amount FROM deals ORDER BY id').all()
    expect(rows).toEqual([
        { id: 'd1', amount: 120 },
        { id: 'd2', amount: 200 },
    ])
    expect(`commits: ${commits}`).toBe('commits: 1')
})

// 47.27 — A COLUMN IS AN SQL IDENTIFIER, a row's own shape checked even after another row prepared a
// statement its columns join to the same text as. THE REVERT: drop the count check from
// `statementFor`; `{ id, "name,amount" }` hits the statement `{ id, name, amount }` prepared and
// writes NULLs rather than being refused.
test('a column that is no SQL identifier is refused, whatever shape came before it — 47.27', async () => {
    const db = deals()
    const writer = table<Record<string, unknown>>(
        db,
        'deals',
    ).writable.getWriter()
    await writer.write({ id: 'd1', name: 'Acme', amount: 100 })
    await Bun.sleep(5)
    await writer.write({ id: 'd2', 'name,amount': 1 })
    await Bun.sleep(5)
    expect(
        await writer.close().then(
            () => 'closed',
            (thrown: Error) => thrown.message,
        ),
    ).toContain('is not an SQL identifier')
})

// 47.26 — A CHANGE REFRESHES THE TABLE'S `rpc`: a reader of its `GET` is handed the rows a statement
// the table never saw wrote. THE REVERT: drop the `follow` call from `rpc`'s table read; `total: 100`
// stands.
test('a change refreshes the GET of an rpc over the table — 47.26', async () => {
    const db = deals()
    db.run("INSERT INTO deals VALUES ('d1', 'Acme', 100)")
    const served = rpc(table<Deal>(db, 'deals'))
    const read = reactive(() => served())
    let total = 0
    const stop = watch(() => {
        total = 0
        for (const deal of read.get() ?? []) total += deal.amount
    })
    flushSync()
    await until(() => total === 100)
    db.run("INSERT INTO deals VALUES ('d2', 'Globex', 50)")
    await until(() => total === 150)
    stop()
    expect(`total: ${total}`).toBe('total: 150')
})

// 47.48 — A TABLE CALLED FOLLOWS NOTHING: a value that called it runs once, whatever the table does
// after. THE REVERT: have the table's call make the run it is made in follow the table; `runs: 2`
// where 1 is due.
test('a value that called the table is not refreshed by its changes — 47.48', async () => {
    const db = deals()
    const dealRows = table<Deal>(db, 'deals')
    dealRows.upsert({ id: 'd1', name: 'Acme', amount: 10 })
    let runs = 0
    const count = keyedValue(() => {
        runs += 1
        return dealRows().length
    })()
    expect(count.get()).toBe(1)
    dealRows.upsert({ id: 'd2', name: 'Globex', amount: 20 })
    db.run("INSERT INTO deals VALUES ('d3', 'Initech', 30)")
    await Bun.sleep(150)
    expect(`count: ${count.get()}, runs: ${runs}`).toBe('count: 1, runs: 1')
})
