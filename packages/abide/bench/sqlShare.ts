// 47.29 — WHAT THE `sql` TAG COSTS OVER THE VANILLA ARM: a statement the app prepared once by hand and
// ran with `.all()`, against `opener.sql` at one call site, outside every run and inside a memo
// entry's run. Each pair is one `batch()` (43.7, 43.11): interleaved, sized past the clock, the
// first arm its own A/A control, and the ratio claimed only outside that floor.
//
// `bun packages/abide/bench/sqlShare.ts`

import { batch, type Batched, claimOf, ratio } from '@abide/harness/report'

import { database } from '#server'
import { keyedValue } from '#shared/reactive/index.ts'

process.env.NODE_ENV = 'bench'
const db = database(':memory:', {
    migrations: [
        'CREATE TABLE deals (id TEXT PRIMARY KEY, stage TEXT NOT NULL, amount INTEGER NOT NULL)',
        "INSERT INTO deals VALUES ('d1', 'won', 100), ('d2', 'lead', 40)",
    ],
})

// THE VANILLA ARM: prepared by hand, held by the app, run.
const byHand = db().prepare('SELECT amount FROM deals WHERE id = ?')
let call = 0
const id = () => (call++ & 1 ? 'd1' : 'd2')
const arms = {
    vanilla: () => {
        byHand.all(id())
    },
    tagged: () => {
        db.sql`SELECT amount FROM deals WHERE id = ${id()}`
    },
}

function report(label: string, measured: Batched): void {
    const vanilla = measured.samples.vanilla
    const tagged = measured.samples.tagged
    if (vanilla === undefined || tagged === undefined) return
    console.log(
        `── ${label}   [n=${measured.n} A/A floor=${(measured.floor * 100).toFixed(2)}% ${measured.substrate}]`,
    )
    console.log(`  vanilla  ${vanilla.nanoseconds.toFixed(0)} ns/call`)
    console.log(
        `  tagged   ${tagged.nanoseconds.toFixed(0)} ns/call   ${claimOf(ratio(tagged, vanilla, { floor: measured.floor }))}`,
    )
}

report(
    'outside a run',
    batch({ case: 'sql outside a run', arms, emulated: null }),
)

// The same pair inside one memo entry's run, where a read is made in the run it would refresh.
let inside: Batched | undefined
keyedValue(() => {
    inside = batch({ case: 'sql inside a run', arms, emulated: null })
    return 0
})().get()
if (inside !== undefined) report('inside a run', inside)
