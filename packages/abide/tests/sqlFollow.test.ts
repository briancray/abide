// 47.33, 18.3 — A HANDLER READING A TABLE IS FOLLOWED THROUGH IT: a write to the table, made through
// the app's own `sql` or committed by another connection, reaches a browser following a `GET` whose
// body read it — the value where the server holds one, a trigger where it does not — with no tag
// written to say which table.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { applyPatch } from '#shared/applyPatch.ts'

import { handlerFiles, serveApp } from './builtApp.ts'
import { muxClient } from './muxClient.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const FILE = `${process.env.TMPDIR ?? '/tmp'}/abide-sql-follow-${process.pid}-${Date.now()}.sqlite`

const HANDLERS = `import { database, GET, POST, table } from '@abide/abide/server'

const db = database(${JSON.stringify(FILE)}, {
    migrations: [
        'CREATE TABLE deals (id TEXT PRIMARY KEY, stage TEXT NOT NULL)',
        "INSERT INTO deals VALUES ('d1', 'won'), ('d2', 'lead'), ('d3', 'lead')",
    ],
})
const deals = table<{ id: string; stage: string }>(db, 'deals')

export const won = GET(
    () => db.sql<{ id: string }>\`SELECT id FROM deals WHERE stage = 'won' ORDER BY id\`.map((row) => row.id),
    { global: true },
)

export const staged = GET(({ stage }: { stage: string }) => deals({ stage }).map((row) => row.id))

// 47.4 — the file the server opened, a scratch one under test, which another connection opens too.
export const where = GET(() => db().filename)

export const close = POST(({ id }: { id: string }) => {
    db.sql\`UPDATE deals SET stage = 'won' WHERE id = \${id}\`
})
`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'index.abide': '<main>home</main>',
        ...handlerFiles('crm', HANDLERS),
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

const client = (steps: string) => muxClient(base, 'crm', steps)

/** `held` with a patch frame's ops applied, as a follower standing at it takes them. */
function patched(held: unknown, frame: Record<string, unknown> | undefined) {
    const copy = structuredClone(held)
    applyPatch(copy, frame?.ops as Parameters<typeof applyPatch>[1])
    return copy
}

// THE REVERT: drop `readTables` from the tag in `sqlOver`; the served entry never reloads, and the
// follower is sent no frame where a patch is due.
test("a write through the app's sql reaches a follower of a GET whose body read the table — 47.33", async () => {
    const frames = await client(`const answered = await get('won')
const version = Number(String(answered.headers.get('etag')).replace(/[^0-9]/g, ''))
frames.push({ op: 'answered', value: await answered.json() })
send({ op: 'sub', id: 1, address: '/crm/won', version })
await settled()
await post('close', { id: 'd2' })
await until((frames) => frames.some((frame) => frame.op === 'patch' || frame.op === 'value'))
`)
    const held = frames[0]?.value
    const sent = frames.find(
        (frame) => frame.op === 'patch' || frame.op === 'value',
    )
    const now = sent?.op === 'value' ? sent.value : patched(held, sent)
    expect(`${JSON.stringify(held)} -> ${JSON.stringify(now)}`).toBe(
        '["d1"] -> ["d1","d2"]',
    )
})

// 47.26 — another connection's commit is heard through the table's triggers and its watch. THE
// REVERT: drop `readTables` from the tag in `sqlOver`; the follower is sent no frame where a patch is
// due.
test('a commit by another connection reaches a follower of a GET whose body read the table — 47.33', async () => {
    const frames = await client(`const answered = await get('won')
const version = Number(String(answered.headers.get('etag')).replace(/[^0-9]/g, ''))
frames.push({ op: 'answered', value: await answered.json() })
send({ op: 'sub', id: 1, address: '/crm/won', version })
await settled()
const { Database } = await import('bun:sqlite')
const other = new Database(await (await get('where')).json())
other.run("UPDATE deals SET stage = 'won' WHERE id = 'd3'")
other.close()
await until((frames) => frames.some((frame) => frame.op === 'patch' || frame.op === 'value'))
`)
    const held = frames[0]?.value as string[]
    const sent = frames.find(
        (frame) => frame.op === 'patch' || frame.op === 'value',
    )
    const now = (
        sent?.op === 'value' ? sent.value : patched(held, sent)
    ) as string[]
    expect(now.filter((id) => !held.includes(id))).toEqual(['d3'])
})

// 47.39 — A `GET` THE SERVER HOLDS NO VALUE OF between requests: its follower is sent a trigger, to
// fetch again. THE REVERT: hand `readsOne` nothing in `Followers.sweep`; the browser is sent `[]`
// where `['invalidate']` is due.
test('a follower of a GET the server holds no value of is sent a trigger when its table changes — 47.39', async () => {
    const frames = await client(`await (await get('staged?stage=lead')).json()
send({ op: 'sub', id: 2, address: '/crm/staged', args: { stage: 'lead' } })
await settled()
const { Database } = await import('bun:sqlite')
const other = new Database(await (await get('where')).json())
other.run("INSERT INTO deals VALUES ('d9', 'lead')")
other.close()
await until((frames) => frames.length > 0)
`)
    expect(frames.map((frame) => frame.op)).toEqual(['invalidate'])
})
