// THE REACTIVE CORE, PRICED AGAINST THE HAND-WRITTEN ARM under bun's JSC. The cases
// live in `reactiveCases.ts` so the browser injectable runs the same bytes; see there
// for why the substrate matters more than the numbers.

import { reactive } from 'abide'
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

sixTwo()

await machinery()
