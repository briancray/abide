// Runs `sharedCases` through the one batcher, in whichever engine loaded it.
import {
    batch,
    type BatchSpec,
    claimOf,
    emulatedDom,
    ratio,
    type Sample,
} from '@abide/harness/report'

import { sharedCases } from './sharedCases.ts'

export type SharedRow = {
    case: string
    arms: Record<string, number>
    /** Each arm against the first as `ratio()` claims it (43.7): a number only outside the floor. */
    claims: Record<string, string>
    n: number
    floor: number
    substrate: string
}

/** Batches every shared case and returns one row per case, each arm in nanoseconds per op. */
export function runShared(
    budgetNanoseconds: number,
    sizing?: Pick<BatchSpec, 'reps' | 'warmup'>,
): SharedRow[] {
    const rows: SharedRow[] = []
    for (const kase of sharedCases()) {
        const measured = batch({
            case: kase.name,
            arms: kase.arms,
            emulated: emulatedDom(),
            budgetNanoseconds,
            ...sizing,
        })
        const names = Object.keys(kase.arms)
        const base = measured.samples[names[0] as string] as Sample
        const arms: Record<string, number> = {}
        const claims: Record<string, string> = {}
        for (const name of names) {
            const sample = measured.samples[name] as Sample
            arms[name] = sample.nanoseconds
            claims[name] =
                sample === base
                    ? 'base'
                    : claimOf(ratio(sample, base, { floor: measured.floor }))
        }
        rows.push({
            case: kase.name,
            arms,
            claims,
            n: measured.n,
            floor: measured.floor,
            substrate: String(measured.substrate),
        })
    }
    return rows
}

/** Formats shared rows as text: each arm's nanoseconds and its claim against the first arm. */
export function formatShared(rows: SharedRow[]): string {
    const lines: string[] = []
    for (const row of rows) {
        lines.push(
            `── ${row.case}   [n=${row.n} A/A floor=${(row.floor * 100).toFixed(2)}% ${row.substrate}]`,
        )
        for (const name of Object.keys(row.arms)) {
            const ns = row.arms[name] as number
            lines.push(
                `  ${name.padEnd(34)} ${ns.toFixed(1).padStart(9)} ns   ${row.claims[name]}`,
            )
        }
    }
    return lines.join('\n')
}
