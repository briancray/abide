// 47.27, 47.34, 47.37-47.42 — A TABLE DESCRIBED BY ITS DATABASE: the key it writes by is the table's
// primary key, a `BOOLEAN` or `JSON` column is read and written as one through a table and through
// `sql`, a list of any length is one statement per shape, a change carries the columns asked for, a
// write inside a transaction refreshes on its commit, and a reader is never handed a gap silently.

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'

import { type Change, database, rpc, table } from '#server'
import { flushSync, reactive, watch } from '#shared'

let opened = 0

/** A fresh database holding `migrations`. */
function opener(...migrations: string[]) {
    opened += 1
    return database(`described-${opened}`, { migrations })
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

// 47.27, 47.37 — THE KEY IS THE TABLE'S OWN: a table keyed by `slug`, and one keyed by two columns,
// upserted with no `key` said. THE REVERT: default the key to `id` in `keyColumns`; the first `upsert`
// throws `carries no id` where the upsert is due.
test("a write upserts by the table's own primary key, one column or several — 47.27, 47.30, 47.37", () => {
    const db = opener(
        'CREATE TABLE stages (slug TEXT PRIMARY KEY, label TEXT NOT NULL)',
        'CREATE TABLE tags (dealId INTEGER NOT NULL, tag TEXT NOT NULL, note TEXT, PRIMARY KEY (dealId, tag))',
    )
    const stages = table(db, 'stages')
    stages.upsert({ slug: 'won', label: 'Won' })
    stages.upsert({ slug: 'won', label: 'Closed won' })
    const tags = table(db, 'tags')
    tags.upsert([
        { dealId: 1, tag: 'hot', note: null },
        { dealId: 1, tag: 'big', note: null },
    ])
    tags.update({ dealId: 1, tag: 'hot', note: 'called twice' })
    expect({ stages: stages(), tags: tags({ note: { ne: null } }) }).toEqual({
        stages: [{ slug: 'won', label: 'Closed won' }],
        tags: [{ dealId: 1, tag: 'hot', note: 'called twice' }],
    })
    let said = ''
    try {
        tags.upsert({ dealId: 2 } as never)
    } catch (thrown) {
        said = (thrown as Error).message
    }
    expect(said).toContain('carries no tag')
})

// 47.38, 47.39 — A COLUMN IS READ AND WRITTEN AS IT IS DECLARED, through a table, its changes and
// `sql`. THE REVERT: return `value` from `decoded`; `won` reads `1` and `notes` reads its text.
test('a BOOLEAN and a JSON column are read and written as what they declare — 47.38, 47.39', async () => {
    const db = opener(
        'CREATE TABLE deals (id INTEGER PRIMARY KEY, won BOOLEAN NOT NULL, notes JSON, amount INTEGER)',
    )
    const deals = table(db, 'deals')
    const reading = taken(deals.readable, 2)
    deals.upsert({
        id: 1,
        won: true,
        notes: { calls: 2, tags: ['hot'] },
        amount: 5,
    })
    deals.upsert({ id: 2, won: false, notes: 'plain', amount: null })
    const changes = await reading
    const viaSql = db.sql`SELECT d.id, d.won, d.notes, d.won + 0 AS score FROM deals d ORDER BY d.id`
    expect({
        table: deals(),
        matched:
            deals({ won: true, notes: 'plain' }).length +
            deals({ notes: 'plain' }).length,
        changes: changes.map((change) => change.row),
        viaSql,
        stored: db().query('SELECT won, notes FROM deals ORDER BY id').all(),
    }).toEqual({
        table: [
            { id: 1, won: true, notes: { calls: 2, tags: ['hot'] }, amount: 5 },
            { id: 2, won: false, notes: 'plain', amount: null },
        ],
        matched: 1,
        changes: [
            { id: 1, won: true, notes: { calls: 2, tags: ['hot'] }, amount: 5 },
            { id: 2, won: false, notes: 'plain', amount: null },
        ],
        // `score` is an expression, read as SQLite hands it over.
        viaSql: [
            { id: 1, won: true, notes: { calls: 2, tags: ['hot'] }, score: 1 },
            { id: 2, won: false, notes: 'plain', score: 0 },
        ],
        stored: [
            { won: 1, notes: '{"calls":2,"tags":["hot"]}' },
            { won: 0, notes: '"plain"' },
        ],
    })
})

// 47.34 — A LIST OF ANY LENGTH, ONE STATEMENT PER SHAPE: lengths 3 and 4 share a statement, 5 and 8
// another, and two lists past 1024 one more — and a list past what SQLite binds to one statement is
// still one list. THE REVERT: key the cache by length in `sqlOver`; `prepared: 6` where 3 is due.
// Or bind every list a `?` per value; the 70000 list throws `too many SQL variables`.
test('a list of any length is bound in one statement per shape — 47.34', () => {
    const db = opener('CREATE TABLE deals (id INTEGER PRIMARY KEY)')
    const connection = db()
    connection.run(
        'WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM n WHERE id < 2000) INSERT INTO deals SELECT id FROM n',
    )
    const prepare = connection.prepare.bind(connection)
    let prepared = 0
    connection.prepare = ((text: string) => {
        prepared += 1
        return prepare(text)
    }) as typeof connection.prepare
    const among = (ids: number[]) =>
        db.sql<{ id: number }>`SELECT id FROM deals WHERE id IN ${ids}`.length
    const range = (from: number, count: number) =>
        Array.from({ length: count }, (_, at) => from + at)
    const counts = [
        among(range(1, 3)),
        among(range(1, 4)),
        among(range(1, 5)),
        among(range(1, 8)),
        among(range(1, 1500)),
        among(range(1, 1900)),
        among(range(1, 70_000)),
    ]
    expect(`${counts.join()} prepared: ${prepared}`).toBe(
        '3,4,5,8,1500,1900,2000 prepared: 3',
    )
    const deals = table(db, 'deals')
    expect(deals({ id: range(1, 70_000) }).length).toBe(2000)
    expect(deals({ id: [...range(1, 3), null] }).length).toBe(3)
})

// 47.40 — A CHANGE CARRIES WHAT IS LOGGED: the key and the columns named, the wide column left out.
// THE REVERT: log every column in `prepare` whatever `LOGGED` holds; `probe` rides every change.
test('a table given logged records its key and those columns alone — 47.40', async () => {
    const db = opener(
        'CREATE TABLE files (id INTEGER PRIMARY KEY, mediaId INTEGER, probe JSON)',
    )
    const files = table(db, 'files', { logged: ['mediaId'] })
    const reading = taken(files.readable, 2)
    files.upsert({ id: 1, mediaId: 7, probe: { streams: [1, 2, 3] } })
    files.update({ id: 1, mediaId: 8 })
    const changes = await reading
    expect(changes.map(({ row, previous }) => ({ row, previous }))).toEqual([
        { row: { id: 1, mediaId: 7 }, previous: undefined },
        { row: { id: 1, mediaId: 8 }, previous: { id: 1, mediaId: 7 } },
    ])
})

// 47.41 — A WRITE INSIDE A TRANSACTION REFRESHES THE TABLE'S `rpc` ON ITS COMMIT, and one rolled back
// never does. THE REVERT: drop the `inTransaction` test in `wrote`; the total reads 150 inside the
// transaction that is then rolled back, where 100 is due.
test('a write inside a transaction refreshes once it commits, and not at all where it rolls back — 47.41', async () => {
    const db = opener(
        'CREATE TABLE deals (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)',
        'INSERT INTO deals VALUES (1, 100)',
    )
    const deals = table<{ id: number; amount: number }>(db, 'deals')
    const served = rpc(deals)
    const read = reactive(() => served())
    let total = 0
    const stop = watch(() => {
        total = 0
        for (const deal of read.get() ?? []) total += deal.amount
    })
    flushSync()
    await until(() => total === 100)
    let seenInside: number | undefined
    try {
        db().transaction(() => {
            deals.upsert({ id: 2, amount: 50 })
            flushSync()
            seenInside = total
            throw new Error('rolled back')
        })()
    } catch {}
    await Bun.sleep(150)
    db().transaction(() => {
        deals.upsert({ id: 3, amount: 25 })
    })()
    await until(() => total === 125)
    stop()
    expect(`inside: ${seenInside}, total: ${total}`).toBe(
        'inside: 100, total: 125',
    )
})

// 47.28, 47.42 — A READER IS NEVER HANDED A GAP: the watch keeps what a reader here has still to read,
// and a reader behind a removal another process made errors rather than skipping. THE REVERT: drop the
// `abide_changes_removed` test in `changesOf`; the reader hands on the change past the gap as if it
// were next.
test('a reader behind changes another process removed errors rather than skip them — 47.42', async () => {
    const db = opener(
        'CREATE TABLE deals (id INTEGER PRIMARY KEY, amount INTEGER)',
    )
    const deals = table(db, 'deals')
    const reader = deals.readable.getReader()
    deals.upsert({ id: 1, amount: 1 })
    expect((await reader.read()).value?.row).toEqual({ id: 1, amount: 1 })
    deals.upsert({ id: 2, amount: 2 })
    deals.upsert({ id: 3, amount: 3 })
    // Another process's watch trimmed past this reader.
    const other = new Database(db().filename)
    other.run("DELETE FROM abide_changes WHERE tbl = 'deals'")
    other.run(
        "INSERT INTO abide_changes_removed (tbl, through) VALUES ('deals', 1000) ON CONFLICT (tbl) DO UPDATE SET through = 1000",
    )
    other.close()
    let said = ''
    try {
        await reader.read()
    } catch (thrown) {
        said = (thrown as Error).message
    }
    expect(said).toContain('RULEBOOK 47.42')
})

// 47.28 — THE LOG IS KEPT FOR A READER HERE: past the 10000 kept, a reader still behind reads every
// change. THE REVERT: trim to `last - CHANGES_KEPT` alone in the watch; the reader meets 47.42's error.
test('the watch keeps every change a reader in this process has still to read — 47.28', async () => {
    const db = opener('CREATE TABLE ticks (id INTEGER PRIMARY KEY)')
    const ticks = table(db, 'ticks')
    const reader = ticks.readable.getReader()
    ticks.upsert({ id: 0 })
    await reader.read()
    db().run(
        'WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM n WHERE id < 10100) INSERT INTO ticks SELECT id FROM n',
    )
    // Two looks of the watch, each of which trims.
    await Bun.sleep(150)
    let read = 0
    let last = 0
    while (read < 10_100) {
        const { value } = await reader.read()
        last = value?.row?.id as number
        read += 1
    }
    await reader.cancel()
    expect(`read: ${read}, last: ${last}`).toBe('read: 10100, last: 10100')
})

// 47.49, 47.30 — AN INSERT IS ANSWERED AS STORED, its key assigned; a column left `undefined` is not
// named, so a patch leaves it and an insert takes its default. THE REVERT: name every key of the row in
// `statementFor`; the update writes `notes` NULL where `"kept"` is due.
test('an insert answers its rows as stored, and an undefined column is not written — 47.49, 47.30', () => {
    const db = opener(
        "CREATE TABLE deals (id INTEGER PRIMARY KEY, name TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'lead', notes JSON)",
    )
    const deals = table(db, 'deals')
    const stored = deals.insert([
        { name: 'Acme', notes: 'kept' },
        { name: 'Globex', stage: undefined, notes: { calls: 1 } },
    ])
    deals.update({ id: 1, name: 'Acme Co', notes: undefined })
    expect({ stored, after: deals({ id: 1 }) }).toEqual({
        stored: [
            { id: 1, name: 'Acme', stage: 'lead', notes: 'kept' },
            { id: 2, name: 'Globex', stage: 'lead', notes: { calls: 1 } },
        ],
        after: [{ id: 1, name: 'Acme Co', stage: 'lead', notes: 'kept' }],
    })
})

// 47.50 — A PLAIN OBJECT BOUND IN SQL IS ITS JSON. THE REVERT: drop the `isPlainData` arm in
// `flattened`; bun refuses the object as a binding.
test('a plain object interpolated into sql is bound as its JSON — 47.50', () => {
    const db = opener('CREATE TABLE deals (id INTEGER PRIMARY KEY, notes JSON)')
    db.sql`INSERT INTO deals (id, notes) VALUES (1, ${{ calls: 3 }})`
    expect(db.sql`SELECT notes FROM deals`).toEqual([{ notes: { calls: 3 } }])
})

// 47.36 — A TABLE DECLARED OPENS NOTHING until it is used. THE REVERT: call `watchOf` in `table`
// itself; the opener has opened by the time the module declaring the table is read.
test('declaring a table opens nothing until the table is used — 47.36', () => {
    let opens = 0
    opened += 1
    const db = database(`described-${opened}`, {
        migrations: ['CREATE TABLE deals (id INTEGER PRIMARY KEY)'],
        open: () => {
            opens += 1
        },
    })
    const deals = table(db, 'deals')
    const before = opens
    deals()
    expect(`before: ${before}, after: ${opens}`).toBe('before: 0, after: 1')
})

// 47.52 — A TABLE FIRST REACHED IN A TRANSACTION THAT ROLLS BACK still logs its changes after: the
// triggers the rollback unmade are made again. THE REVERT: record the table prepared inside the
// transaction in `prepare`; the insert after logs nothing, and the reader waits out its deadline.
test('a table first reached in a transaction that rolls back still logs its changes after — 47.52', async () => {
    const db = opener(
        'CREATE TABLE deals (id INTEGER PRIMARY KEY, amount INTEGER)',
    )
    const deals = table(db, 'deals')
    try {
        db().transaction(() => {
            deals.upsert({ id: 1, amount: 1 })
            throw new Error('rolled back')
        })()
    } catch {}
    const reading = taken(deals.readable, 1)
    deals.insert({ amount: 2 })
    const changes = await Promise.race([
        reading,
        Bun.sleep(1_000).then(() => [] as Change<{ amount: number }>[]),
    ])
    expect(changes.map((change) => change.row?.amount)).toEqual([2])
})

// 47.53 — AN UPDATE THAT CHANGES NOTHING IS NO CHANGE: a self-assigning upsert logs nothing, and the
// next real change is the next one read. THE REVERT: drop the `WHEN` from the update trigger in
// `prepare`; the reader is handed the no-op first, `amount 1 was 1`.
test('an update that leaves every column as it was records no change — 47.53', async () => {
    const db = opener(
        'CREATE TABLE deals (id INTEGER PRIMARY KEY, amount INTEGER)',
    )
    const deals = table(db, 'deals')
    deals.upsert({ id: 1, amount: 1 })
    const reading = taken(deals.readable, 1)
    db.sql`INSERT INTO deals (id, amount) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET amount = amount`
    db.sql`UPDATE deals SET amount = amount WHERE id = 1`
    deals.update({ id: 1, amount: 2 })
    const [change] = await reading
    expect(
        `amount ${change?.row?.amount} was ${change?.previous?.amount}`,
    ).toBe('amount 2 was 1')
})

// 47.24 — A READER LET GO IS FOLLOWED BY A NEW ONE: `readable` after a cancel hands on what came
// after. THE REVERT: cache the first stream in the getter for good; the second `getReader` throws, the
// stream locked and cancelled.
test('readable after a cancelled reader is a new stream that reads on — 47.24', async () => {
    const db = opener(
        'CREATE TABLE deals (id INTEGER PRIMARY KEY, amount INTEGER)',
    )
    const deals = table(db, 'deals')
    await taken(deals.readable, 0)
    const reading = taken(deals.readable, 1)
    deals.upsert({ id: 1, amount: 7 })
    expect((await reading).map((change) => change.row?.amount)).toEqual([7])
})

// 47.54 — A READER FOLLOWS ITS OPENER: over the same file reopened it reads on, and over another
// file it errors rather than read a log it has no place in. THE REVERT: drop the log check in
// `changesOf`; the reader behind the old file's count hands on nothing until its deadline.
test('a reader reads on across a reopen of its file, and errors over another file — 47.54', async () => {
    const db = opener(
        'CREATE TABLE deals (id INTEGER PRIMARY KEY, amount INTEGER)',
    )
    const deals = table(db, 'deals')
    const reader = deals.readable.getReader()
    deals.upsert({ id: 1, amount: 1 })
    await reader.read()
    db.close()
    deals.upsert({ id: 2, amount: 2 })
    const same = (await reader.read()).value?.row?.amount
    db.close({ remove: true })
    deals.upsert({ id: 3, amount: 3 })
    let said = ''
    try {
        await reader.read()
    } catch (thrown) {
        said = (thrown as Error).message
    }
    expect({ same, other: said.includes('RULEBOOK 47.54') }).toEqual({
        same: 2,
        other: true,
    })
})

// 47.42 — A READER STARTS PAST WHAT WAS REMOVED, though none of the log remains: it is not behind
// what it never had to read. THE REVERT: start at the log's last change alone in `changesOf`; every
// read errors with 47.42's message.
test('a reader starting after every change was removed reads on — 47.42', async () => {
    const db = opener(
        'CREATE TABLE deals (id INTEGER PRIMARY KEY, amount INTEGER)',
    )
    const deals = table(db, 'deals')
    deals.upsert({ id: 1, amount: 1 })
    db().run("DELETE FROM abide_changes WHERE tbl = 'deals'")
    db().run(
        "INSERT INTO abide_changes_removed (tbl, through) SELECT 'deals', seq FROM sqlite_sequence WHERE name = 'abide_changes' ON CONFLICT (tbl) DO UPDATE SET through = excluded.through",
    )
    const fresh = table(db, 'deals', { logged: [] })
    const reading = taken(fresh.readable, 1)
    fresh.upsert({ id: 2, amount: 2 })
    expect((await reading).map((change) => change.row?.amount)).toEqual([2])
})
