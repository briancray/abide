// NAME THE SHARE of `pipe` and `ledger` against hand-written arms, before their machinery is called
// worth it (CLAUDE.md, "performance and measurement").
//
// PIPE: per-item overhead of a pipe running a step that does nothing, against the FIFO lane media
// writes by hand (`queue.ts`: a counter, an array and a `finally`), both at `concurrency` 4. Then the
// same overhead as a share of a step that does real work — a SQLite insert — which is what a lane
// is for: the ratio of two no-op arms says what the machinery costs, the share says whether anyone
// would notice it.
//
// LEDGER: the cost of an append at two lengths of the same in-memory log under `retain`, which is
// the one timing claim that stays honest across substrates — if raising the cap made each append
// dearer, the retention would be rebuilt per write.
//
// Async arms, so not `batch()` (which times a synchronous body): each arm runs `n` items, the arms
// interleaved, five rounds, and the fastest round per arm is kept.
//
// `bun run bench:family`

import { Database } from 'bun:sqlite'

import { RedisClient } from 'bun'

import * as store from '#server/stores.ts'
import { ledger } from '#shared/ledger.ts'
import { pipe } from '#shared/pipe.ts'

const ITEMS = 20_000
const ROUNDS = 5
const LANES = 4

/** media's `general/lib/queue.ts`, as written there: the vanilla arm. */
function queue<Args extends unknown[], Result>(
    fn: (...args: Args) => Promise<Result>,
    maxParallel: number,
): (...args: Args) => Promise<Result> {
    const items: {
        args: Args
        resolve: (value: Result) => void
        reject: (reason: unknown) => void
    }[] = []
    let running = 0
    function next(): void {
        if (running >= maxParallel) return
        const item = items.shift()
        if (!item) return
        running += 1
        fn(...item.args)
            .then(item.resolve)
            .catch(item.reject)
            .finally(() => {
                running -= 1
                next()
            })
    }
    return (...args: Args) =>
        new Promise<Result>((resolve, reject) => {
            items.push({ args, resolve, reject })
            next()
        })
}

async function timed(run: () => Promise<void>): Promise<number> {
    const started = Bun.nanoseconds()
    await run()
    return Bun.nanoseconds() - started
}

async function fastest(
    arms: Record<string, () => Promise<void>>,
): Promise<Record<string, number>> {
    const best: Record<string, number> = {}
    for (let round = 0; round < ROUNDS; round += 1)
        for (const [name, run] of Object.entries(arms)) {
            Bun.gc(true)
            const took = await timed(run)
            best[name] = Math.min(best[name] ?? Number.POSITIVE_INFINITY, took)
        }
    return best
}

const perItem = (total: number, items: number): string =>
    `${(total / items / 1000).toFixed(2)} µs`

// PIPE ARMS
const noop = async (n: number): Promise<number> => n
const lane = queue(noop, LANES)
const piped = pipe([noop], { concurrency: LANES })

const db = new Database(':memory:')
db.run('CREATE TABLE rows (n INTEGER)')
const insert = db.query('INSERT INTO rows VALUES (?)')
const write = async (n: number): Promise<number> => {
    insert.run(n)
    return n
}
const writeLane = queue(write, LANES)
const writePipe = pipe([write], { concurrency: LANES })

const all = (call: (n: number) => unknown) => async (): Promise<void> => {
    const pending: unknown[] = []
    for (let n = 0; n < ITEMS; n += 1) pending.push(call(n))
    await Promise.all(pending)
}

const lanes = await fastest({
    'queue.ts, no-op step': all(lane),
    'pipe, no-op step': all(piped),
    'queue.ts, sqlite insert': all(writeLane),
    'pipe, sqlite insert': all(writePipe),
})
const vanilla = lanes['queue.ts, no-op step'] as number
const machinery = lanes['pipe, no-op step'] as number
const vanillaWrite = lanes['queue.ts, sqlite insert'] as number
const pipeWrite = lanes['pipe, sqlite insert'] as number
console.log(
    `pipe — ${ITEMS} items at concurrency ${LANES}, fastest of ${ROUNDS}`,
)
for (const [name, took] of Object.entries(lanes))
    console.log(`  ${name.padEnd(26)} ${perItem(took, ITEMS)} per item`)
console.log(
    `  no-op ratio, pipe / queue.ts: ${(machinery / vanilla).toFixed(2)}x`,
)
console.log(
    `  pipe's added cost as a share of a sqlite-insert item: ${(((pipeWrite - vanillaWrite) / pipeWrite) * 100).toFixed(1)}%`,
)

// LEDGER ARMS
const APPENDS = 20_000
const appendsAt = (retain: number) => async (): Promise<void> => {
    const log = ledger<number>({ retain })
    // Filled to its cap first: what is timed is an append into a log already at `retain`.
    for (let n = 0; n < retain; n += 1) await log.append(n)
    const started = Bun.nanoseconds()
    for (let n = 0; n < APPENDS; n += 1) await log.append(n)
    appendTook.set(
        retain,
        Math.min(
            appendTook.get(retain) ?? Number.POSITIVE_INFINITY,
            Bun.nanoseconds() - started,
        ),
    )
}
const appendTook = new Map<number, number>()
await fastest({
    'retain 1,000': appendsAt(1_000),
    'retain 100,000': appendsAt(100_000),
})
const small = appendTook.get(1_000) as number
const large = appendTook.get(100_000) as number
console.log(
    `ledger — ${APPENDS} appends into a log at its cap, fastest of ${ROUNDS}`,
)
console.log(`  retain 1,000    ${perItem(small, APPENDS)} per append`)
console.log(`  retain 100,000  ${perItem(large, APPENDS)} per append`)
console.log(`  ratio, 100,000 / 1,000: ${(large / small).toFixed(2)}x`)

// WHERE A LEDGER IS KEPT: one append each, awaited in turn, into memory, SQLite on disk and — where
// `ABIDE_REDIS_URL` names a server — Redis, whose append is one script round trip.
const STORED = 5_000
/** A store key no earlier case's rows sit under. */
let named = 0
const sqliteFile = `${process.env.TMPDIR ?? '/tmp'}/abide-bench-ledger-${Date.now()}.sqlite`
const kept: Record<string, () => Promise<void>> = {
    memory: async () => {
        const log = ledger<number>()
        for (let n = 0; n < STORED; n += 1) await log.append(n)
    },
    sqlite: async () => {
        const log = ledger<number>({
            store: store.sqlite(sqliteFile, `bench-${(named += 1)}`),
        })
        for (let n = 0; n < STORED; n += 1) await log.append(n)
    },
}
if (process.env.ABIDE_REDIS_URL !== undefined) {
    const client = new RedisClient(process.env.ABIDE_REDIS_URL)
    kept.redis = async () => {
        const log = ledger<number>({
            store: store.redis(client, `bench-${Date.now()}-${(named += 1)}`),
        })
        for (let n = 0; n < STORED; n += 1) await log.append(n)
    }
}
const atOnce =
    (make: () => ReturnType<typeof ledger<number>>) =>
    async (): Promise<void> => {
        const log = make()
        const pending: Promise<number>[] = []
        for (let n = 0; n < STORED; n += 1) pending.push(log.append(n))
        await Promise.all(pending)
    }
kept['sqlite, at once'] = atOnce(() =>
    ledger<number>({
        store: store.sqlite(sqliteFile, `bench-${(named += 1)}`),
    }),
)
if (process.env.ABIDE_REDIS_URL !== undefined) {
    const many = new RedisClient(process.env.ABIDE_REDIS_URL)
    kept['redis, at once'] = atOnce(() =>
        ledger<number>({
            store: store.redis(many, `bench-${Date.now()}-${(named += 1)}`),
        }),
    )
}
const keptTook = await fastest(kept)
console.log(
    `ledger stores — ${STORED} appends awaited in turn, fastest of ${ROUNDS}`,
)
for (const [name, took] of Object.entries(keptTook))
    console.log(`  ${name.padEnd(16)} ${perItem(took, STORED)} per append`)
process.exit(0)
