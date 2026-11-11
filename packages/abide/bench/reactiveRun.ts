// Runs `reactiveCases` through the one batcher, in whichever engine loaded it.
import {
    batch,
    type BatchSpec,
    claimOf,
    emulatedDom,
    ratio,
    type Sample,
} from '@abide/harness/report'

import { reactiveCases } from './reactiveCases.ts'

/** One case's reading: each arm in nanoseconds per op, the claim, and the work it was checked on. */
export type ReactiveBenchRow = {
    case: string
    distinguishes: string
    abide: number
    vanilla: number
    claim: string
    n: number
    reps: number
    floor: number
    substrate: string
    work: Record<string, number>
    workDisagreement: string[]
}

/** Batches every reactive case, abide against the hand-written arm, and returns one row per case. */
export function runReactive(
    budgetNanoseconds: number,
    sizing?: Pick<BatchSpec, 'reps' | 'warmup'>,
): ReactiveBenchRow[] {
    const rows: ReactiveBenchRow[] = []
    for (const kase of reactiveCases()) {
        const measured = batch({
            case: kase.name,
            arms: { vanilla: kase.vanilla, abide: kase.abide },
            emulated: emulatedDom(),
            budgetNanoseconds,
            ...sizing,
        })
        const counted = kase.work()
        const vanillaSample: Sample = {
            ...(measured.samples.vanilla as Sample),
            work: counted.vanilla,
        }
        const abideSample: Sample = {
            ...(measured.samples.abide as Sample),
            work: counted.abide,
        }
        const result = ratio(abideSample, vanillaSample, {
            floor: measured.floor,
        })
        rows.push({
            case: kase.name,
            distinguishes: kase.distinguishes,
            abide: abideSample.nanoseconds,
            vanilla: vanillaSample.nanoseconds,
            claim: claimOf(result),
            n: measured.n,
            reps: measured.reps,
            floor: measured.floor,
            substrate: String(measured.substrate),
            work: counted.abide,
            workDisagreement: result.workDisagreement,
        })
    }
    return rows
}

/** The rows as the report both lanes print: each case's two arms, its claim, and whether the work agrees. */
export function formatReactive(rows: ReactiveBenchRow[]): string {
    const lines: string[] = []
    for (const row of rows) {
        lines.push(`── ${row.case}`)
        lines.push(`  distinguishes: ${row.distinguishes}`)
        lines.push(
            `  abide ${row.abide.toFixed(1)} ns   vanilla ${row.vanilla.toFixed(1)} ns   ${row.claim}`,
        )
        lines.push(
            `  n=${row.n} reps=${row.reps} substrate=${row.substrate} A/A floor=${(row.floor * 100).toFixed(2)}%`,
        )
        if (row.workDisagreement.length > 0)
            lines.push(
                `  WORK DISAGREES — ${row.workDisagreement.join('; ')}\n  The arms are not doing the same job, so the ratio prices two different jobs.`,
            )
        else lines.push(`  work agrees: ${JSON.stringify(row.work)}`)
        lines.push('')
    }
    return lines.join('\n')
}
