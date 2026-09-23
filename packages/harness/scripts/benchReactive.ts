// THE REACTIVE CORE, PRICED AGAINST THE HAND-WRITTEN ARM under bun's JSC. The cases
// live in `reactiveCases.ts` so the browser injectable runs the same bytes; see there
// for why the substrate matters more than the numbers.

import { reactive, watch } from 'abide'
import {
    type Batched,
    batch,
    claimOf,
    ratio,
    type Sample,
} from 'harness/report'
import { countExportedNames } from './countExportedNames.ts'
import { countLines } from './countLines.ts'
import { type Case, reactiveCases } from './reactiveCases.ts'

function report(measured: Batched, work: Case['work']): void {
    const counted = work()
    const vanillaSample = {
        ...(measured.samples.vanilla as Sample),
        work: counted.vanilla,
    }
    const abideSample = {
        ...(measured.samples.abide as Sample),
        work: counted.abide,
    }
    const result = ratio(abideSample, vanillaSample, { floor: measured.floor })
    const vanillaNs = vanillaSample.nanoseconds
    const abideNs = abideSample.nanoseconds
    const claim = claimOf(result)
    console.log(
        `  abide ${abideNs.toFixed(1)} ns   vanilla ${vanillaNs.toFixed(1)} ns   ${claim}`,
    )
    console.log(
        `  n=${measured.n} reps=${measured.reps} substrate=${measured.substrate} A/A floor=${(measured.floor * 100).toFixed(2)}%`,
    )
    if (result.workDisagreement.length > 0)
        console.log(
            `  WORK DISAGREES — ${result.workDisagreement.join('; ')}\n  The arms are not doing the same job, so the ratio prices two different jobs.`,
        )
    else console.log(`  work agrees: ${JSON.stringify(counted.abide)}`)
}

async function machinery(): Promise<void> {
    const abideRoot = new URL(
        '../../abide/src/shared/reactive/',
        import.meta.url,
    )
    const abideFiles = [
        'index.ts',
        'Reactive.ts',
        'Keyed.ts',
        'watch.ts',
        'tracking.ts',
        'structural.ts',
        'canonicalKey.ts',
        'isThenable.ts',
        'NotLanded.ts',
        'REACTIVE_BRAND.ts',
    ]
    const abideLines = await countLines(abideRoot, abideFiles)
    const vanillaLines = await countLines(
        new URL('../src/measure/vanilla/', import.meta.url),
        ['signal.ts'],
    )
    const names = await countExportedNames(['abide'])
    console.log('\nMACHINERY BUDGET — the other half of the trade')
    console.log(
        `  code lines   abide ${abideLines}   vanilla ${vanillaLines}   ${(abideLines / vanillaLines).toFixed(1)}x`,
    )
    console.log(`  exported names on the \`abide\` surface: ${names.total}`)
    console.log(`  ${(names.byEntry.abide ?? []).join(', ')}`)
    console.log(
        '  branches added to a shared path: hand-counted, and not produced here.',
    )
}

const CASES = reactiveCases()

console.log('THE REACTIVE CORE AGAINST THE HAND-WRITTEN ARM')
console.log(
    'Every ratio is abide / vanilla. Over 1.00x means abide is slower.\n',
)

for (const kase of CASES) {
    console.log(`── ${kase.name}`)
    console.log(`  distinguishes: ${kase.distinguishes}`)
    const measured = batch({
        case: kase.name,
        arms: { vanilla: kase.vanilla, abide: kase.abide },
        emulated: null,
    })
    report(measured, kase.work)
    console.log('')
}

// RULEBOOK 6.2 — "Raising `history` MUST NOT make a write dearer" — checked as a RATIO
// BETWEEN TWO SIZES OF THE SAME STRUCTURE, which CLAUDE.md calls the one timing claim
// that stays honest across substrates. There is no vanilla arm and there should not be:
// the earlier log case could not see this at all, because its hand-written arm called
// `shift()` too and both arms were linear in the depth together.
//
// No read in either arm, so nothing is allocated per operation and the GC noise that
// gave that case a 17% floor is gone.
function sixTwo(): void {
    const shallow = reactive<number>(undefined, { history: 16 })
    const deep = reactive<number>(undefined, { history: 4096 })
    let at = 0
    // Filled past their caps before timing, so every timed write is steady state.
    for (let index = 0; index < 20_000; index += 1) {
        shallow.publish(at)
        deep.publish(at)
        at += 1
    }
    const measured = batch({
        case: 'raising history does not make a write dearer',
        arms: {
            'history 16': (): void => {
                shallow.publish(at++)
            },
            'history 4096': (): void => {
                deep.publish(at++)
            },
        },
        emulated: null,
    })
    const small = measured.samples['history 16'] as Sample
    const large = measured.samples['history 4096'] as Sample
    const result = ratio(large, small, { floor: measured.floor })
    console.log('\n6.2 — RAISING `history` MUST NOT MAKE A WRITE DEARER')
    console.log(
        `  history 16 ${small.nanoseconds.toFixed(1)} ns   history 4096 ${large.nanoseconds.toFixed(1)} ns`,
    )
    // THE COMPARISON IS AGAINST WHAT LINEAR WOULD PREDICT, not against 1.00x. The depth
    // rises 256x between the arms, so a write that scaled with retention would read
    // ~256x; anything near 1x is a constant-time write however the A/A floor classifies
    // the last few per cent. Reading `ratio()`'s verdict as the answer here would call a
    // 5% difference a violation and a 256x one a pass on a noisy day.
    const predicted = 4096 / 16
    const observed = result.kind === 'ratio' ? result.value : 1 + measured.floor
    console.log(
        `  ${observed.toFixed(2)}x measured against ${predicted}x if the write scaled with the depth`,
    )
    console.log(
        `  ${observed < predicted / 10 ? '6.2 HOLDS — the write is constant in the depth' : '6.2 IS VIOLATED — the write scales with retention'}`,
    )
}

// MOUNTING READERS IS LINEAR IN THE READER COUNT — the SLOPE half of the `track` dedup, which
// `mount 50 readers on one value` cannot see: that case is abide against the hand-written arm
// at one width, so it catches a CONSTANT the subscribe path grows and divides no slope out.
// This is abide against ITSELF at two widths, which cancels the constant and leaves the slope.
//
// THE BAR IS CALIBRATED, NOT PREDICTED, which is the whole of 6.2's shape above and the thing
// a first attempt here got wrong. Asking "is this 4x (linear) or 16x (quadratic)" answers
// "linear" for BOTH arms, because at any width this can price, `watch` construction dominates
// and the n² term is a minority of the op — so a bar between the two complexity classes never
// sees the difference. 6.2 does not do that either: it measures depth 16 against depth 4096
// and asserts the result is ~1x against "256x if it scaled", a bar set by what the FIXED
// mechanism measures.
// THE BAR, AND WHAT IT IS A FACT ABOUT. Three runs each way on this machine under JSC at these
// two widths: 5.88x / 6.49x / 7.00x with the reader-side dedup, against 8.72x / 8.73x / 9.40x
// with the readers-side scan. 7.8 sits ~11% clear of both ends. Linear predicts 112/16 = 7x and
// the fixed arm measures there, which is the check on the check.
//
// THE WIDTH IS WHAT MAKES THE BAR HOLDABLE, and 64 was not enough. At 64 the same pair came out
// 3.36-3.61x fixed against 3.85-4.67x broken — separated in expectation, but the tails touch: a
// bar at 3.8 sat 1.3% under the lowest broken run, inside the 0.4-8% A/A floor, so it would
// have called a clean tree VIOLATED on an unlucky afternoon. The n² term grows as the square
// while the op grows linearly, so the gap opens with width: 6.6% of the op at 64, 24.6% at 112.
//
// AND 112 STILL PRICES, which is the constraint that bounds the other end — `batch` takes n=7
// there. Push the width until the op clears the clock bar in ONE rep (200 readers is 26.7 µs)
// and `ratio()` refuses the sample as `underOneFrame` and the row becomes a figure. So the
// window is "wide enough that n² clears the floor, narrow enough that n stays above 1", and
// 112 is inside it. Believing a width where n² DOMINATES was needed is what closed this search
// the first time, and it was never the requirement.
//
// IT IS BRITTLE IN A WAY 6.2 IS NOT, and that is the price of calibrating a bar instead of
// deriving one: 1x against 256x is a chasm no machine changes, where 7.0 against 8.7 is a gap.
// When it drifts, re-SLACKEN it against a fresh pair of three-run spreads — do not re-derive it
// from a complexity class, which is the mistake that made the first version of this useless.
//
// WHAT ACTUALLY MAKES 7.8 SAFE IS THE DIRECTION OF THE NOISE, not the 11%. Almost all of the
// variance is in the NARROW arm, which is the divisor: across seventeen clean runs `mount 16`
// spread 1.61x where `mount 112` spread 1.26x, because the narrow arm is the one nearer the
// clock floor. So a loaded process inflates the divisor more than the dividend and COMPRESSES
// the ratio — the two slowest narrow samples were exactly the two lowest ratios. Confirmed on a
// quieter machine, where the same pairing holds with a tighter spread: narrow 1398.7 ns gave the
// highest ratio of six runs (6.97x) and narrow 1589.3 ns one of the lowest (6.53x). This bar
// fails HIGH, so contention moves the number AWAY from it and a false VIOLATED is the direction
// that cannot happen. Seventeen clean runs put the upper tail at 7.02x.
//
// WHICH MAKES A `HOLDS` THE WEAKER VERDICT, and it is the reverse of the habit: CLAUDE.md says
// re-run a timing FAILURE before believing it, and here it is a timing PASS that a loaded run
// should not be believed on. A false HOLDS needs the broken arm to dip 12% under its observed
// 8.72x minimum — unlikely, since broken's spread is only 1.11x (at 112 the n² term swamps the
// noise) — but it is the reachable error of the two. Read a HOLDS on a busy machine as "not
// shown to be violated" rather than as "shown to be linear".
//
// THE LEVER IF IT DRIFTS, before re-slackening: widen the NARROW arm to 24, since that is where
// the variance actually lives. It costs separation — linear then predicts 112/24 = 4.67x rather
// than 7x, so the fixed and broken bands sit closer together — so it is a trade rather than a
// free fix, but it attacks the variance source instead of the symptom.
const LINEAR_AT_112 = 7.8

function mountingIsLinear(): void {
    const NARROW = 16
    const WIDE = 112
    const mount = (width: number) => (): void => {
        const source = reactive(0)
        const stops: (() => void)[] = []
        for (let index = 0; index < width; index += 1)
            stops.push(
                // A tracked read is a side effect, so there is nothing here to eliminate.
                watch(() => {
                    source()
                }),
            )
        for (const stop of stops) stop()
    }
    const measured = batch({
        case: 'mounting readers is linear in the reader count',
        arms: {
            [`mount ${NARROW}`]: mount(NARROW),
            [`mount ${WIDE}`]: mount(WIDE),
        },
        emulated: null,
    })
    const narrow = measured.samples[`mount ${NARROW}`] as Sample
    const wide = measured.samples[`mount ${WIDE}`] as Sample
    const result = ratio(wide, narrow, { floor: measured.floor })
    console.log('\nMOUNTING READERS IS LINEAR IN THE READER COUNT')
    console.log(
        `  mount ${NARROW} ${narrow.nanoseconds.toFixed(1)} ns   mount ${WIDE} ${wide.nanoseconds.toFixed(1)} ns`,
    )
    if (result.kind !== 'ratio') {
        console.log(`  no claim — ${claimOf(result)}`)
        return
    }
    console.log(
        `  ${result.value.toFixed(2)}x measured against ${LINEAR_AT_112} if the subscribe path is linear in the readers already attached`,
    )
    console.log(
        `  ${result.value <= LINEAR_AT_112 ? 'HOLDS — a reader arriving does not pay for the readers already there' : 'VIOLATED — the subscribe path scales with the readers already attached'}`,
    )
}

sixTwo()
mountingIsLinear()

await machinery()
