// 16.117, 16.118 — AN `rpc` OVER A SOURCE ANSWERS ITS WHOLE FACE: its call reads it by `GET`, and each
// write is a member sent by its own verb — a memo's `set`, `patch` and `refresh`, a table's `set`,
// `patch` and `delete`, a job's `run`, a pipe's `push`, a ledger's `append` — in process on the server
// and over the wire from a browser's copy.

import { afterEach, expect, test } from 'bun:test'

import { database, job, rpc, table } from '#server'
import type { App } from '#server/createApp.ts'
import { ledger, memo, pipe } from '#shared'
import { wire } from '#ui/wire.ts'

import { inMemoryApp } from './inMemoryApp.ts'

type Deal = { id: string; stage: string; amount: number }

let opened = 0

/** A fresh database with two deals. */
function crm() {
    opened += 1
    return database(`rpc-sources-${opened}`, {
        migrations: [
            'CREATE TABLE deals (id TEXT PRIMARY KEY, stage TEXT NOT NULL, amount INTEGER NOT NULL)',
            "INSERT INTO deals VALUES ('d1', 'won', 100), ('d2', 'lead', 40)",
        ],
    })
}

/** `app`'s answer to `method` at `address` with `body`, as `status text`. */
async function sent(
    app: App,
    method: string,
    address: string,
    body?: unknown,
): Promise<string> {
    const answer = await app.fetch(
        new Request(`http://app.invalid${address}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? null : JSON.stringify(body),
        }),
    )
    return `${answer.status} ${await answer.text()}`
}

const unstubbedFetch = globalThis.fetch
afterEach(() => {
    globalThis.fetch = unstubbedFetch
})

// 16.111, 16.117 — EACH KIND ANSWERS THE VERBS ITS MEMBERS WRITE BY, and `methods` keeps fewer; a memo
// answers its read alone until `methods` names its writes. A memo whose entries live a request
// answers `GET` alone whatever `methods` names: a write to one would land where no request reads it.
// THE REVERTS: give `rpc` no source arm (`brandOf` answering `undefined`); every source reads as a
// function, `["GET"]` each where its verbs are due. Answer `able` with no `methods` in
// `sourceVerbs`; the global memo's first row is `["GET","PUT","PATCH","POST"]` where `["GET"]` is due.
test("an rpc answers the verbs a source's members write by — 16.111, 16.117", () => {
    const deals = table<Deal>(crm(), 'deals')
    const digest = job({
        name: 'rpc-sources-digest',
        every: 3_600_000,
        run: () => undefined,
    })
    const verbs = [
        rpc(memo(() => 1, { global: true })).methods,
        rpc(
            memo(() => 1, { global: true }),
            {
                methods: ['GET', 'PUT', 'PATCH', 'POST'],
            },
        ).methods,
        rpc(memo(() => 1)).methods,
        rpc(deals).methods,
        rpc(deals, { methods: ['GET'] }).methods,
        rpc(digest).methods,
        rpc(pipe([(n: number) => n + 1])).methods,
        rpc(ledger<string>()).methods,
    ]
    void digest.stop()
    expect(verbs).toEqual([
        ['GET'],
        ['GET', 'PUT', 'PATCH', 'POST'],
        ['GET'],
        ['GET', 'PUT', 'PATCH', 'DELETE'],
        ['GET'],
        ['GET', 'POST'],
        ['GET', 'POST'],
        ['GET', 'POST'],
    ])
    expect(() =>
        rpc(
            memo(() => 1),
            { methods: ['GET', 'PUT'] },
        ),
    ).toThrow('RULEBOOK 16.112, 16.117')
})

// 16.111, 16.117 — AN RPC'S FACE IS TYPED BY THE VERBS IT ANSWERS: a memo's and a value's writes are
// members only where `methods` names their verbs, and a table's, a job's, a pipe's and a ledger's are
// until `methods` leaves them out. THE REVERT: type the memo and value forms `Rpc` again and the
// source forms' members unconditionally; each `@ts-expect-error` below is unused and fails
// `bun run typecheck`.
test("an rpc's members are typed by the verbs it answers — 16.111, 16.117", () => {
    const board = rpc(memo(() => ({ n: 0 }), { global: true }))
    const written = rpc(
        memo(() => ({ n: 0 }), { global: true }),
        { methods: ['GET', 'PATCH'] },
    )
    const theme = rpc({ mode: 'dark' })
    const settable = rpc({ mode: 'dark' }, { methods: ['GET', 'PUT'] })
    const deals = rpc(table<Deal>(crm(), 'deals'), { methods: ['GET', 'PUT'] })
    const notes = rpc(ledger<string>(), { methods: ['GET'] })
    // @ts-expect-error a memo answering `GET` alone is set by no verb
    void board.set
    // @ts-expect-error nor patched
    void board.patch
    // @ts-expect-error `methods` named `PATCH`, not `PUT`
    void written.set
    // @ts-expect-error a value answering `GET` alone is set by no verb
    void theme.set
    // @ts-expect-error a table whose `methods` leave out `DELETE`
    void deals.delete
    // @ts-expect-error a ledger read alone
    void notes.append
    expect(
        [written.patch, settable.set, deals.set].map((member) => typeof member),
    ).toEqual(['function', 'function', 'function'])
})

// 16.117 — A TABLE'S RPC READS ITS ROWS BY A JSON MATCH AND WRITES THEM BY KEY, over the wire as in
// process. THE REVERT: drop the faces loop in `rpc`; `PUT`, `PATCH` and `DELETE` answer 405.
test("a table's rpc is read by a match and written by key over the wire — 16.117", async () => {
    const db = crm()
    const deals = rpc(table<Deal>(db, 'deals'))
    await using app = await inMemoryApp({
        'crm/deals.server.ts': { default: deals },
    })
    const ids = () =>
        db.sql<{
            id: string
            stage: string
            amount: number
        }>`SELECT * FROM deals ORDER BY id`
            .map((row) => `${row.id}:${row.stage}:${row.amount}`)
            .join(',')
    const read = await sent(
        app,
        'GET',
        `/crm/deals?stage=${encodeURIComponent(JSON.stringify('won'))}`,
    )
    const writes = [
        await sent(app, 'PUT', '/crm/deals', {
            given: [{ id: 'd3', stage: 'lead', amount: 7 }],
        }),
        await sent(app, 'PATCH', '/crm/deals', {
            given: [{ id: 'd2', stage: 'won' }],
        }),
        // A `DELETE` carries its args in the query, as a `GET` does (16.9).
        await sent(
            app,
            'DELETE',
            `/crm/deals?given=${encodeURIComponent(JSON.stringify([{ id: 'd1' }]))}`,
        ),
    ]
    expect([
        read.split(' ')[0],
        ...writes.map((each) => each.split(' ')[0]),
    ]).toEqual(['200', '200', '200', '200'])
    expect(ids()).toBe('d2:won:40,d3:lead:7')
    await deals.set({ id: 'd4', stage: 'won', amount: 1 })
    expect((await deals({ stage: 'won' })).map((row) => row.id)).toEqual([
        'd2',
        'd4',
    ])
})

// 16.118 — `columns` IS WHAT A TABLE'S RPC READS AND WRITES: a row is answered with those alone, and a
// write or a match naming another is refused at 400. THE REVERT: drop `withinColumns` from the
// table's writer; the `PUT` naming `amount` answers 200 and writes it.
test("a table's rpc reads and writes the columns it names alone — 16.118", async () => {
    const db = crm()
    const deals = rpc(table<Deal>(db, 'deals'), { columns: ['id', 'stage'] })
    await using app = await inMemoryApp({
        'crm/deals.server.ts': { default: deals },
    })
    expect((await deals()) as unknown).toEqual([
        { id: 'd1', stage: 'won' },
        { id: 'd2', stage: 'lead' },
    ])
    const refused = await sent(app, 'PUT', '/crm/deals', {
        given: [{ id: 'd1', stage: 'won', amount: 1 }],
    })
    expect(refused.split(' ')[0]).toBe('400')
    expect(
        db.sql<{ amount: number }>`SELECT amount FROM deals WHERE id = 'd1'`[0]
            ?.amount,
    ).toBe(100)
    expect(() =>
        rpc(
            memo(() => 1),
            { columns: ['id'] },
        ),
    ).toThrow('RULEBOOK 16.118')
})

// 16.117 — A MEMO'S RPC IS WRITTEN AS ITS OWNER WRITES IT, where `methods` names the writes: `PUT` its
// `set`, `PATCH` its `patch` by the JSON Patch the browser made, `POST` its `refresh`. THE REVERT: drop
// the held branch answering the value in the face; `PUT` answers `null` where the value written is due.
test("a memo's rpc is set, patched and refreshed over the wire — 16.117", async () => {
    let runs = 0
    const seats = rpc(
        memo(
            ({ team }: { team: string }) => {
                runs += 1
                return { team, seats: 10 }
            },
            { global: true },
        ),
        { methods: ['GET', 'PUT', 'PATCH', 'POST'] },
    )
    await using app = await inMemoryApp({
        'account/seats.server.ts': { default: seats },
    })
    expect(await seats({ team: 'a' })).toEqual({ team: 'a', seats: 10 })
    expect(
        await sent(app, 'PUT', '/account/seats', {
            given: [{ team: 'a' }, { team: 'a', seats: 12 }],
        }),
    ).toBe('200 {"team":"a","seats":12}')
    expect(
        await sent(app, 'PATCH', '/account/seats', {
            given: [{ team: 'a' }],
            ops: [{ op: 'replace', path: '/seats', value: 15 }],
        }),
    ).toBe('200 {"team":"a","seats":15}')
    expect(await seats({ team: 'a' })).toEqual({ team: 'a', seats: 15 })
    expect(
        (
            await sent(app, 'POST', '/account/seats', {
                given: [{ team: 'a' }],
            })
        ).split(' ')[0],
    ).toBe('200')
    expect(await seats({ team: 'a' })).toEqual({ team: 'a', seats: 10 })
    expect(runs).toBe(2)
})

// 16.89 — A VALUE'S WRITE REFRESHES WHAT ITS `refreshes` NAMES, as any mutation's does: the read takes
// none, and the write faces take it. THE REVERT: leave `refreshes` out of `facesOptions`; the tagged
// memo ran `1` time where `2` is due — and before this, declaring it at all threw 16.92's refusal.
test("a value's write refreshes what its refreshes names — 16.89", async () => {
    let runs = 0
    const seen = memo(
        () => {
            runs += 1
            return runs
        },
        { global: true, tags: ['seats'] },
    )
    const seats = rpc(
        { seats: 10 },
        { methods: ['GET', 'PUT'], refreshes: ['seats'] },
    )
    await using app = await inMemoryApp({
        'account/seats.server.ts': { default: seats },
    })
    await seen()
    expect(
        await sent(app, 'PUT', '/account/seats', { given: [{ seats: 12 }] }),
    ).toBe('200 {"seats":12}')
    await seen()
    expect(runs).toBe(2)
})

// 16.117 — A JOB'S RPC READS ITS STATUS AND RUNS IT; A PIPE'S READS ITS STATUS AND PUSHES AN ITEM; A
// LEDGER'S READS ITS ENTRIES AND APPENDS. THE REVERT: attach no members to `main`; `digest.run` is not
// a function.
test("a job's, a pipe's and a ledger's rpc read and write their own members — 16.117", async () => {
    let ran = 0
    const digest = rpc(
        job({
            name: 'rpc-sources-run',
            every: 3_600_000,
            run: () => {
                ran += 1
            },
        }),
    )
    const doubled = rpc(pipe([(n: number) => n * 2]))
    const notes = rpc(ledger<string>())
    await using app = await inMemoryApp({
        'ops/digest.server.ts': { default: digest },
        'ops/doubled.server.ts': { default: doubled },
        'ops/notes.server.ts': { default: notes },
    })
    await digest.run()
    const run = await sent(app, 'POST', '/ops/digest', { given: [] })
    const pushed = await sent(app, 'POST', '/ops/doubled', { given: [21] })
    expect(await notes.append('first')).toBe(1)
    const appended = await sent(app, 'POST', '/ops/notes', {
        given: ['second'],
    })
    const status = (await digest()) as { running: boolean }
    expect([ran, run.split(' ')[0], pushed, appended, status.running]).toEqual([
        2,
        '200',
        '200 42',
        '200 2',
        false,
    ])
    await (digest as unknown as { stop?: () => unknown }).stop?.()
})

// 16.117 — A BROWSER'S COPY OF A SOURCE SENDS EACH MEMBER BY ITS VERB, with what it was given, and
// reads itself again once answered. THE REVERT: drop `sendsMembers` from `wire`; `delete` is no
// function and nothing is sent.
test("a browser's copy of a source sends each member by its verb — 16.117", async () => {
    const sent: string[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        if (method !== 'GET')
            sent.push(`${method} ${url} ${String(init?.body)}`)
        return new Response(JSON.stringify(method === 'GET' ? [] : 1), {
            headers: { 'content-type': 'application/json' },
        })
    }) as unknown as typeof fetch
    const copy = wire(['GET', 'PUT', 'PATCH', 'DELETE'], '/crm/deals', {
        faces: { set: 'PUT', patch: 'PATCH', delete: 'DELETE' },
    }) as unknown as {
        set(rows: unknown): Promise<unknown>
        patch(rows: unknown): Promise<unknown>
        delete(match: unknown): Promise<unknown>
    }
    await copy.set({ id: 'd3', stage: 'lead' })
    await copy.patch({ id: 'd3', stage: 'won' })
    expect(await copy.delete({ id: 'd3' })).toBe(1)
    expect(sent).toEqual([
        'PUT /crm/deals {"given":[{"id":"d3","stage":"lead"}]}',
        'PATCH /crm/deals {"given":[{"id":"d3","stage":"won"}]}',
        'DELETE /crm/deals?given=%5B%7B%22id%22%3A%22d3%22%7D%5D undefined',
    ])
})

// 16.6 — AN `rpc` OVER A MEMO WHOSE ARGS ARE OPTIONAL IS CALLED WITHOUT THEM, as the memo is. A type
// test: `Args` inferred from the memo's `invalidate` dropped the `undefined`, and `rpc(tags)()` was
// refused as "expected 1-2 arguments". THE REVERT: infer the memo overload's four parameters off the
// argument rather than reading it whole through `MemoOf` — the `typecheck` fails on the calls below.
test('an rpc over a memo with optional args is called without them — 16.6', async () => {
    const tags = memo(async (args?: { type?: string }) => [args?.type ?? 'all'])
    const byType = rpc(tags)
    expect(await byType()).toEqual(['all'])
    expect(await byType({ type: 'genre' })).toEqual(['genre'])
    const deal = rpc(memo(async (args: { id: string }) => args.id))
    // @ts-expect-error a memo whose args are required still asks for them
    void (() => deal())
    expect(await deal({ id: 'd1' })).toBe('d1')
    // A streaming memo is a memo too: its call answers its chunks, not a promise, and the overload
    // that read only promise-answering memos turned it away as "not assignable to never".
    const ticks = rpc(
        memo(async function* () {
            yield 'tick'
        }),
    )
    const chunks: () => AsyncIterable<string> = () => ticks()
    expect(typeof chunks).toBe('function')
})
