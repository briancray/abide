// 47.29, 16.117, 18.3 — A TABLE IS FOLLOWED THROUGH WHAT CALLED IT: a write through its `rpc`, or a
// commit another connection makes, reaches a browser following the table's own `rpc` and every
// `global` `GET` whose run called the table.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { applyPatch } from '#shared/applyPatch.ts'

import { handlerFiles, serveApp } from './builtApp.ts'
import { muxClient } from './muxClient.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const FILE = `${process.env.TMPDIR ?? '/tmp'}/abide-sql-follow-${process.pid}-${Date.now()}.sqlite`

const HANDLERS = `import { database, rpc, table } from '@abide/abide/server'

const db = database(${JSON.stringify(FILE)}, {
    migrations: [
        'CREATE TABLE deals (id TEXT PRIMARY KEY, stage TEXT NOT NULL)',
        "INSERT INTO deals VALUES ('d1', 'won'), ('d2', 'lead'), ('d3', 'lead')",
    ],
})
const dealRows = table<{ id: string; stage: string }>(db, 'deals')
export const deals = rpc(dealRows)

export const won = rpc(
    () => dealRows({ stage: 'won' }).map((row) => row.id).sort(),
    { global: true },
)

// 47.4 — the file the server opened, a scratch one under test, which another connection opens too.
export const where = rpc(() => db().filename)
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

/** The value a follower holds once `frames`' first change after its answer has landed on `held`. */
function landed(held: unknown, frames: Record<string, unknown>[]) {
    const sent = frames.find(
        (frame) => frame.op === 'patch' || frame.op === 'value',
    )
    return sent?.op === 'value' ? sent.value : patched(held, sent)
}

// 47.29, 16.117 — A WRITE THROUGH THE TABLE'S `rpc` REACHES A FOLLOWER OF A `GET` THAT CALLED IT, at
// once. THE REVERT: drop `refreshCells` from `changed` in table.ts; the follower is sent no frame where
// `["d1"] -> ["d1","d2"]` is due.
test("a write through a table's rpc reaches a follower of a GET that called the table — 47.29, 16.117", async () => {
    const frames = await client(`const answered = await get('won')
const version = Number(String(answered.headers.get('etag')).replace(/[^0-9]/g, ''))
frames.push({ op: 'answered', value: await answered.json() })
send({ op: 'sub', id: 1, address: '/crm/won', version })
await settled()
await fetch(base + '/crm/deals', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ given: [{ id: 'd2', stage: 'won' }] }) })
await until((frames) => frames.some((frame) => frame.op === 'patch' || frame.op === 'value'))
`)
    const held = frames[0]?.value
    expect(
        `${JSON.stringify(held)} -> ${JSON.stringify(landed(held, frames))}`,
    ).toBe('["d1"] -> ["d1","d2"]')
})

// 47.26, 16.117 — ANOTHER CONNECTION'S COMMIT IS HEARD THROUGH THE TABLE'S TRIGGERS AND ITS WATCH, and
// a follower of the table's own `rpc` for a match is sent its rows as they now stand. THE REVERT: give
// a table's read no tag in `readOptions`; the follower is sent no frame where `d3` is due.
test("a commit by another connection reaches a follower of a table's rpc — 47.26, 16.117", async () => {
    const frames = await client(`const answered = await get('deals?stage=won')
const version = Number(String(answered.headers.get('etag')).replace(/[^0-9]/g, ''))
frames.push({ op: 'answered', value: await answered.json() })
send({ op: 'sub', id: 1, address: '/crm/deals', args: { stage: 'won' }, version })
await settled()
const { Database } = await import('bun:sqlite')
const other = new Database(await (await get('where')).json())
other.run("UPDATE deals SET stage = 'won' WHERE id = 'd3'")
other.close()
await until((frames) => frames.some((frame) => frame.op === 'patch' || frame.op === 'value'))
`)
    const held = frames[0]?.value as { id: string }[]
    const now = landed(held, frames) as { id: string }[]
    const ids = (rows: { id: string }[]) => rows.map((row) => row.id)
    expect(ids(now).filter((id) => !ids(held).includes(id))).toEqual(['d3'])
})
