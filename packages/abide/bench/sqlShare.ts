// 47.32 — WHAT THE `sql` TAG COSTS OVER THE VANILLA ARM: a statement the app prepared once by hand and
// ran with `.all()`, against `opener.sql` at one call site, outside every run and inside a memo
// entry's run (where it records what the statement read). One sample is a batch of `CALLS` reads, well
// past the clock's resolution; the median of `SAMPLES` is reported.
//
// `bun packages/abide/bench/sqlShare.ts`

import { database } from '#server'
import { keyedValue } from '#shared/reactive/index.ts'

import { median } from './median.ts'

const CALLS = 100_000
const SAMPLES = 7

process.env.NODE_ENV = 'bench'
const db = database(':memory:', {
    migrations: [
        'CREATE TABLE deals (id TEXT PRIMARY KEY, stage TEXT NOT NULL, amount INTEGER NOT NULL)',
        "INSERT INTO deals VALUES ('d1', 'won', 100), ('d2', 'lead', 40)",
    ],
})

// THE VANILLA ARM: prepared by hand, held by the app, run.
const byHand = db().prepare('SELECT amount FROM deals WHERE id = ?')
const vanilla = (id: string) => byHand.all(id)
const tagged = (id: string) => db.sql`SELECT amount FROM deals WHERE id = ${id}`

function sample(read: (id: string) => unknown): number {
    const start = Bun.nanoseconds()
    for (let call = 0; call < CALLS; call += 1) read(call & 1 ? 'd1' : 'd2')
    return (Bun.nanoseconds() - start) / CALLS
}

/** The same batch inside one memo entry's run, where a read is recorded against the run. */
function inRun(read: (id: string) => unknown): number {
    let perCall = 0
    keyedValue(() => {
        perCall = sample(read)
        return perCall
    })()()
    return perCall
}

const arms: Record<string, number[]> = {
    vanilla: [],
    tagged: [],
    vanillaInRun: [],
    taggedInRun: [],
}
for (let round = 0; round < SAMPLES; round += 1) {
    arms.vanilla?.push(sample(vanilla))
    arms.tagged?.push(sample(tagged))
    arms.vanillaInRun?.push(inRun(vanilla))
    arms.taggedInRun?.push(inRun(tagged))
}
const ns = (arm: string) => median(arms[arm] as number[])
for (const arm of Object.keys(arms))
    console.log(`${arm.padEnd(14)} ${ns(arm).toFixed(0)} ns/call`)
console.log(
    `ratio outside a run: ${(ns('tagged') / ns('vanilla')).toFixed(2)}x`,
)
console.log(
    `ratio inside a run:  ${(ns('taggedInRun') / ns('vanillaInRun')).toFixed(2)}x`,
)
