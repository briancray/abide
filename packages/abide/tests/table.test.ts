// 47.25-47.31 — A TABLE AS A STREAM PAIR: every committed change read out in order, whoever wrote it,
// none for a write rolled back; rows written in upserted a turn at a time; and a change refreshing
// what called the table.

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'

import { type Change, table } from '#server'
import { keyedValue } from '#shared/reactive/index.ts'

type Deal = { id: string; name: string; amount: number }

function deals(): Database {
    const db = new Database(':memory:')
    db.run(
        'CREATE TABLE deals (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount INTEGER NOT NULL)',
    )
    return db
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

// 47.25 — A TABLE THE DATABASE DOES NOT HOLD IS REFUSED where it is first reached. THE REVERT: drop the
// column check in `prepare`, and the triggers are made over nothing.
test('table refuses a table the database does not hold — 47.25', () => {
    let said = 'built'
    try {
        void table(new Database(':memory:'), 'missing').writable
    } catch (thrown) {
        said = (thrown as Error).message.includes('47.25') ? 'refused' : 'other'
    }
    expect(said).toBe('refused')
})

// 47.39 — A TABLE DECLARED OPENS NOTHING, so a module declaring one at import time opens its database
// only once the app's config names where. THE REVERT: stand the table's watch up in `table` itself
// rather than at its first call or write; the opener is called at the declaration, 1 open where 0
// are due.
test('a table declared does not open its database until it is called — 47.39', () => {
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

// 47.26, 47.27, 47.28 — EVERY COMMITTED WRITE, BY ANY STATEMENT, IS ONE CHANGE, IN ORDER; ONE ROLLED
// BACK IS NONE. The writes here are raw SQL, not the pair's: the triggers are what capture them.
// THE REVERT: capture in the pair's writable alone, and nothing raw SQL wrote is read.
test('a table reads every committed change in order, and none rolled back — 47.26, 47.27, 47.28', async () => {
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

// 47.30 — ROWS WRITTEN ARE UPSERTED BY KEY, A TURN'S WRITES ONE TRANSACTION. Counted as the
// transactions the database begins. THE REVERT: commit each write as it comes, and `commits: 3`.
test('rows written are upserted by key, a turn of writes in one transaction — 47.30', async () => {
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

// 47.30 — A COLUMN IS AN SQL IDENTIFIER, a row's own shape checked even after another row prepared a
// statement its columns join to the same text as. THE REVERT: drop the count check from
// `statementFor`; `{ id, "name,amount" }` hits the statement `{ id, name, amount }` prepared and
// writes NULLs rather than being refused.
test('a column that is no SQL identifier is refused, whatever shape came before it — 47.30', async () => {
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

// 47.29 — A CHANGE REFRESHES WHAT CALLED THE TABLE: a value reading the table runs again after a
// write it never heard about. THE REVERT: drop `readBy` from the table's call, and `total: 100` stands.
test('a change refreshes every value that called the table — 47.29', async () => {
    const db = deals()
    db.run("INSERT INTO deals VALUES ('d1', 'Acme', 100)")
    const dealRows = table<Deal>(db, 'deals')
    const total = keyedValue(() => {
        let sum = 0
        for (const deal of dealRows()) sum += deal.amount
        return sum
    })()
    expect(`total: ${total.get()}`).toBe('total: 100')
    db.run("INSERT INTO deals VALUES ('d2', 'Globex', 50)")
    // The watch looks every 50 ms: waited for, with a deadline, rather than slept a fixed time.
    const deadline = Date.now() + 2_000
    while (total.get() !== 150 && Date.now() < deadline) await Bun.sleep(10)
    expect(`total: ${total.get()}`).toBe('total: 150')
})
