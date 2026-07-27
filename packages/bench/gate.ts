// HOT-PATH SHAPE GATE — the fast, hardware-neutral perf check that `bun run verify` runs.
//
//   bun run bench:gate                 # every bound
//   bun run bench:gate -- --list       # print the bound labels, check nothing
//   bun run bench:gate -- memo stream  # check only the bounds naming a matching bench
//
// A filter matches either side of a bound's ratio, and only the benches those bounds need are measured —
// so re-checking one hot path while iterating costs two timings, not the whole primitive corpus. Unlike
// the report runners, an empty selection FAILS here: "all 0 ratios within bounds" is a false green.
//
// Why ratios and not absolute ns: a committed absolute baseline is machine-specific and goes stale the
// moment anyone benches on different hardware. RATIOS between two benches measured in the SAME process on
// the SAME machine are hardware-neutral — which is exactly the trick `packages/docs/e2e/bench.spec.ts`
// already uses to gate SSR's O(n) shape. So each bound below compares a hot path against a neighbour and
// fails only on a genuine constant-factor blowup, not on noise or a slow laptop.
//
// Bounds are set ≈2–2.5× above the observed ratio so they absorb short-budget variance while still
// catching the class of regression ADR 0023 risks (an interface, a per-append effect, or a codec
// dispatcher silently multiplying a per-read or per-message cost).
//
// This runs the PRIMITIVE tiers only — it deliberately skips `server.ts`'s loopback `dispatch/*` benches,
// which boot a real server and carry a TCP floor (slow and noisy for a gate). Use `bun run bench:server`
// for the full table and `bun run bench:delta` to A/B a specific change.

import { benchSelection } from './src/benchSelection.ts'
import { measure } from './src/measure.ts'
import { createReactiveBenches } from './src/reactiveBenches.ts'
import { selectBenches } from './src/selectBenches.ts'
import { createServerBenches } from './src/serverBenches.ts'

const MIN_TIME_MS = Number(process.env.ABIDE_BENCH_GATE_TIME ?? 80)
const MIN_ITERS = Number(process.env.ABIDE_BENCH_GATE_ITERS ?? 10)

interface Bound {
    // `numerator / denominator` must stay under `max`.
    numerator: string
    denominator: string
    max: number
    observed: string
    why: string
}

// Each bound names the ADR 0023 step that puts it at risk.
const BOUNDS: Bound[] = [
    {
        numerator: 'probe/peek-scalar',
        denominator: 'state/get',
        max: 12,
        observed: '≈5.7×',
        why: 'step 4 wraps every probe in a ReactiveReadSurface interface',
    },
    {
        numerator: 'stream/memo-drain',
        denominator: 'stream/push-raw',
        max: 12,
        observed: '≈5.0×',
        why: "the memo's per-chunk hooks (tick + byte accounting); steps 1 and 3 COMPOUND here",
    },
    {
        numerator: 'watch/stream-baseline',
        denominator: 'stream/memo-drain',
        max: 2.5,
        // Moved 1.00× → 1.38× when step 1 landed: watch now fires per append instead of being dead on
        // streams. That rise is INTENDED. The bound guards against it climbing further (e.g. firing per
        // subscriber × chunk); ~1.8× of headroom remains.
        observed: '≈1.38× — was 1.0× before the per-cardinality fix',
        why: 'watch fires per append — a modest rise is intended, a large one is not',
    },
    {
        numerator: 'codec/jsonl-decode',
        denominator: 'codec/jsonl-encode',
        max: 10,
        observed: '≈3.9×',
        why: 'step 3 replaces the decode side with a union codec + dispatcher',
    },
    {
        numerator: 'fanout/push-100',
        denominator: 'fanout/push-10',
        max: 20,
        observed: '≈8.6× (linear would be 10×)',
        why: 'step 6 moves channel reads onto the new surface; catches superlinear fanout',
    },
    {
        numerator: 'memo/read-warm',
        denominator: 'state/get',
        max: 20,
        observed: '≈8.8×',
        why: 'the dominant in-process RPC read path',
    },
]

// A bound's label carries both sides, so a plain substring pattern (`memo`, `stream`) selects every bound
// whose ratio touches that tier without the filter needing to know which side it landed on.
function boundLabel(bound: Bound): string {
    return `${bound.numerator} / ${bound.denominator}`
}

const selection = benchSelection(process.argv.slice(2), { positional: true })
const selected = selectBenches(BOUNDS.map(boundLabel), selection, 'bounds')
const bounds = BOUNDS.filter((bound) => selected.has(boundLabel(bound)))
if (bounds.length === 0) {
    console.error(
        '\x1b[31m✗ bench gate: no bound selected — a gate that checks nothing is a false pass\x1b[0m',
    )
    process.exit(1)
}

// Only the benches the selected bounds actually divide are measured — unfiltered that is already a subset
// of the corpus (the gate names ~10 of ~30 recipes), and a filtered run is two timings. Each bench keeps
// its own warmup and budget, so which OTHER benches ran does not move a ratio.
const needed = new Set<string>()
for (const bound of bounds) {
    needed.add(bound.numerator)
    needed.add(bound.denominator)
}

const timings = new Map<string, number>()
for (const bench of [...(await createServerBenches()), ...(await createReactiveBenches())]) {
    const label = `${bench.group}/${bench.name}`
    if (!needed.has(label)) continue
    const metric = await measure(bench.run, { minTimeMs: MIN_TIME_MS, minIters: MIN_ITERS })
    timings.set(label, metric.nsPerOp)
}

interface Checked {
    bound: Bound
    ratio: number
    ok: boolean
}

const checked: Checked[] = []
for (const bound of bounds) {
    const numerator = timings.get(bound.numerator)
    const denominator = timings.get(bound.denominator)
    if (numerator === undefined || denominator === undefined) {
        console.error(
            `✗ bench gate: missing bench for ${bound.numerator} / ${bound.denominator} — was a recipe renamed?`,
        )
        process.exit(1)
    }
    const ratio = numerator / denominator
    checked.push({ bound, ratio, ok: ratio <= bound.max })
}

const labelWidth = Math.max(
    ...checked.map((c) => `${c.bound.numerator} / ${c.bound.denominator}`.length),
)
console.log(`hot-path shape gate (${MIN_TIME_MS}ms/${MIN_ITERS} iters per bench)\n`)
for (const { bound, ratio, ok } of checked) {
    const label = `${bound.numerator} / ${bound.denominator}`.padEnd(labelWidth)
    const mark = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'
    console.log(
        `${mark} ${label}  ${`${ratio.toFixed(2)}×`.padStart(8)}  ≤ ${`${bound.max}×`.padStart(5)}  (was ${bound.observed})`,
    )
}

const failures = checked.filter((c) => !c.ok)
if (failures.length > 0) {
    console.error(`\n\x1b[31m✗ ${failures.length} hot-path ratio(s) regressed\x1b[0m`)
    for (const { bound, ratio } of failures) {
        console.error(
            `  ${bound.numerator} / ${bound.denominator} = ${ratio.toFixed(2)}× (max ${bound.max}×) — ${bound.why}`,
        )
    }
    console.error(
        '\nRun `bun run bench:server` for the full table, `bun run bench:delta` to A/B it.',
    )
    process.exit(1)
}
const scope =
    checked.length === BOUNDS.length
        ? `all ${checked.length}`
        : `${checked.length} of ${BOUNDS.length} selected`
console.log(`\n\x1b[32m✓ ${scope} hot-path ratios within bounds\x1b[0m`)
