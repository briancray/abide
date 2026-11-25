// 58 — A LEDGER: appended in order and numbered, deduplicated by key, gated by a schema, read from a
// position or a named cursor that resumes where its reader left off, kept in memory or in
// `store.sqlite` one row per entry, and trimmed to `retain` without a copy per write.

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'

import { store } from '#server'
import { computed, jsonSchema, ledger, type LogStore } from '#shared'

/**
 * The numbers of the entries `log` keeps, in order: read from 0 until a turn passes with nothing
 * more handed on, since a read waits past the last entry rather than ending (58.5).
 */
async function keptIn(
    log: (from?: number) => ReadableStream<{ seq: number }>,
): Promise<string> {
    const reader = log(0).getReader()
    const seqs: number[] = []
    for (;;) {
        const next = await Promise.race([
            reader.read(),
            Bun.sleep(5).then(() => undefined),
        ])
        if (next === undefined || next.done) break
        seqs.push(next.value.seq)
    }
    await reader.cancel()
    return seqs.join(',')
}

/** The first `count` entries `stream` hands on, then the stream let go. */
async function taken<Entry>(
    stream: ReadableStream<Entry>,
    count: number,
): Promise<Entry[]> {
    const reader = stream.getReader()
    const out: Entry[] = []
    while (out.length < count) {
        const { value, done } = await reader.read()
        if (done) break
        out.push(value)
    }
    await reader.cancel()
    return out
}

// 58.1 — A LEDGER IS ITS BINDING, not a name: two modules share one by importing it, and two calls
// share entries only through a store. THE REVERT: one memory log for the module, and `other: 2`.
test('each ledger call answers a ledger of its own — 58.1', async () => {
    const first = await ledger<string>().append('opened')
    const other = await ledger<string>().append('opened')
    expect(`first: ${first}, other: ${other}`).toBe('first: 1, other: 1')
})

// 58.2 — EACH APPEND IS NUMBERED ONE PAST THE LAST, and kept after every entry before it. THE
// REVERT: number from the store's count rather than its last, and a trimmed ledger reuses a number.
test('appends are numbered in order, each kept after the last — 58.2', async () => {
    const deals = ledger<string>()
    expect(`kept: ${await keptIn(deals)}`).toBe('kept: ')
    const first = await deals.append('opened')
    const second = await deals.append('won')
    expect(`${first}, ${second}, kept: ${await keptIn(deals)}`).toBe(
        '1, 2, kept: 1,2',
    )
})

// 58.8 — A LEDGER HOLDS NO COPY OF WHAT ITS STORE KEEPS: constructing one asks the store nothing, so
// a ledger of a million rows only appended to and read by a cursor costs no memory for them. THE
// REVERT: ask the store for its last number as the ledger is built, and `asked: 1`.
test('a ledger reads nothing from its store until it is appended to or read — 58.8', async () => {
    let asked = 0
    const counted = (inner: LogStore): LogStore => ({
        ...inner,
        since: (seq) => {
            asked += 1
            return inner.since(seq)
        },
        last: () => {
            asked += 1
            return inner.last()
        },
    })
    const db = new Database(':memory:')
    const activity = ledger<string>({
        store: counted(store.sqlite(db, 'activity')),
    })
    expect(`asked: ${asked}`).toBe('asked: 0')
    await activity.append('Call')
    expect(`kept: ${await keptIn(activity)}`).toBe('kept: 1')
})

// 58.5 AND 9.6 — A LEDGER'S READ IS A VALUE THROUGH A BODY: the stream a call answers is accumulated
// by the value that hands it back, and an append reaches it as one more entry. THE REVERT: end the
// read past the last entry; the value holds what was kept when it was read, and `after: 1`.
test('a value whose body reads a ledger holds every entry, and each append — 58.5, 9.6', async () => {
    const calls = ledger<string>()
    await calls.append('Ada')
    const listed = computed(() => calls())
    await Bun.sleep(5)
    expect(`before: ${listed().length}`).toBe('before: 1')
    await calls.append('Grace')
    await Bun.sleep(5)
    expect(`after: ${listed().length}`).toBe('after: 2')
})

// 58.3 — WHAT THE SCHEMA REFUSES IS KEPT NOWHERE. THE REVERT: append before the gate, and `kept: 1`.
test('an entry the schema refuses is not kept and the append rejects — 58.3', async () => {
    const amounts = ledger({
        schema: jsonSchema<number>({ type: 'number' }),
    })
    let said = ''
    try {
        await amounts.append('ten' as never)
    } catch (thrown) {
        said = (thrown as Error).message.includes('58.3') ? 'refused' : 'other'
    }
    expect(`${said}, kept: ${await keptIn(amounts)}`).toBe('refused, kept: ')
})

// 58.4 — A KEY APPENDED ONCE IS NOT APPENDED AGAIN: the outbox's resend of one call is one entry.
// THE REVERT: drop the key lookup, and `again: 2`.
test('an append under a key already kept keeps nothing and answers its number — 58.4', async () => {
    const calls = ledger<string>()
    const once = await calls.append('save d2', { key: 'k1' })
    const again = await calls.append('save d2', { key: 'k1' })
    expect(`once: ${once}, again: ${again}, kept: ${await keptIn(calls)}`).toBe(
        'once: 1, again: 1, kept: 1',
    )
})

// 58.5, 58.7 — A LEDGER CALLED HANDS ON EVERY ENTRY PAST ITS POSITION, IN ORDER, AND WAITS FOR THE NEXT: an
// entry appended while it waits is handed on. THE REVERT: end the stream past the last, and only
// two entries arrive.
test('a read hands on every entry past its position, and waits for the next — 58.5, 58.7', async () => {
    const feed = ledger<string>()
    await feed.append('a')
    await feed.append('b')
    const reading = taken(feed(), 3)
    const writer = feed.writable.getWriter()
    await writer.write('c')
    writer.releaseLock()
    const read = await reading
    expect(read.map((logged) => `${logged.seq}:${logged.entry}`)).toEqual([
        '1:a',
        '2:b',
        '3:c',
    ])
    const later = await taken(feed(2), 1)
    expect(later[0]?.entry).toBe('c')
})

// 58.6 — A NAMED CURSOR RESUMES PAST WHAT ITS READER FINISHED: an entry is finished once the reader
// asks for the next, so the entry it was handed last is handed again. THE REVERT: move the cursor as
// each entry is handed on, and the second read starts at `c`.
test('a named cursor resumes at the entry its reader had not finished — 58.6', async () => {
    const work = ledger<string>()
    for (const entry of ['a', 'b', 'c']) await work.append(entry)
    const first = await taken(work({ cursor: 'scorer' }), 2)
    const second = await taken(work({ cursor: 'scorer' }), 2)
    expect(first.map((logged) => logged.entry)).toEqual(['a', 'b'])
    expect(second.map((logged) => logged.entry)).toEqual(['b', 'c'])
})

// 58.9 — IN `store.sqlite` A LEDGER IS ONE ROW PER ENTRY, its cursors beside them, and a second
// ledger over the same file reads what the first kept. THE REVERT: keep the log as the store's one
// JSON value, and `rows: 0`.
test('a ledger in store.sqlite keeps a row per entry, and its cursors — 58.9', async () => {
    const db = new Database(':memory:')
    const kept = store.sqlite(db, 'activity')
    const activity = ledger<{ kind: string }>({ store: kept })
    await activity.append({ kind: 'Call' })
    await activity.append({ kind: 'Email' })
    await taken(activity({ cursor: 'feed' }), 2)
    const rows = db
        .query('SELECT COUNT(*) AS rows FROM abide_store_log')
        .get() as {
        rows: number
    }
    const reopened = ledger<{ kind: string }>({ store: kept })
    const resumed = await taken(reopened({ cursor: 'feed' }), 1)
    expect(
        `rows: ${rows.rows}, kept: ${await keptIn(reopened)}, resumed: ${resumed[0]?.entry.kind}`,
    ).toBe('rows: 2, kept: 1,2, resumed: Email')
})

// 58.10, 58.11 — `retain` KEEPS THE LAST ENTRIES AND LETS THE REST GO, and keeping none is refused.
// THE REVERT: drop the trim, and the read from 0 starts at 1.
test('retain keeps the last entries, and under one is refused — 58.10, 58.11', async () => {
    const recent = ledger<number>({ retain: 2 })
    for (let n = 1; n <= 5; n += 1) await recent.append(n)
    const left = await taken(recent(0), 2)
    expect(left.map((logged) => logged.seq)).toEqual([4, 5])
    expect(`kept: ${await keptIn(recent)}`).toBe('kept: 4,5')
    let said = 'built'
    try {
        ledger({ retain: 0 })
    } catch (thrown) {
        said = (thrown as Error).message.includes('58.11') ? 'refused' : 'other'
    }
    expect(said).toBe('refused')
})

// 58.14 — `ttl` IS AN ENTRY'S LIFE FROM ITS APPEND: past it the entry goes, and a read hands on none
// it let go. THE REVERT: drop `expire` from `append` and the read's pull, and `kept: a, b, c`.
test('ttl lets an entry go once its life from the append has passed — 58.14', async () => {
    const recent = ledger<string>({ ttl: 30 })
    await recent.append('a')
    await recent.append('b')
    await Bun.sleep(60)
    await recent.append('c')
    const kept = await taken(recent(0), 1)
    expect(
        `kept: ${kept.map((logged) => logged.entry).join(', ')}, value: ${await keptIn(recent)}`,
    ).toBe('kept: c, value: 3')
})

// 58.15 — A READ PAST WHICH ENTRIES WERE LET GO SAYS SO rather than stepping over them, and a read
// from 0 starts at the oldest kept. THE REVERT: drop the jump check in `read`, and the read from 1
// hands on 4 as if nothing was missed.
test('a read behind entries let go is refused, and a read from 0 is not — 58.15', async () => {
    const recent = ledger<number>({ retain: 2 })
    for (let n = 1; n <= 5; n += 1) await recent.append(n)
    let refusal: { status?: number; message?: string } | undefined
    try {
        await taken(recent(1), 1)
    } catch (thrown) {
        refusal = thrown as { status: number; message: string }
    }
    const fromStart = await taken(recent(0), 1)
    expect(
        `status: ${refusal?.status}, names 2 to 3: ${refusal?.message?.includes('2 to 3')}, from 0: ${fromStart[0]?.seq}`,
    ).toBe('status: 410, names 2 to 3: true, from 0: 4')
})

// 58.16 — A KEY GOES WITH ITS ENTRY: once the entry kept under it is let go, an append under the key
// is a new entry. THE REVERT: keep `keyed` through a trim, and `again: 1`.
test('a key is forgotten with the entry kept under it — 58.16, 58.10', async () => {
    const recent = ledger<string>({ retain: 1 })
    const first = await recent.append('save d2', { key: 'k1' })
    await recent.append('save d3')
    const again = await recent.append('save d2', { key: 'k1' })
    // While entry 3 is kept, a resend under its key is that entry.
    const resent = await recent.append('save d2', { key: 'k1' })
    expect(`first: ${first}, again: ${again}, resent: ${resent}`).toBe(
        'first: 1, again: 3, resent: 3',
    )
})
