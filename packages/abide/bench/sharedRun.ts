// Runs `sharedCases` through the one batcher, in whichever engine loaded it.
import { type BatchSpec, batch, emulatedDom } from '@abide/harness/report'
import { sharedCases } from './sharedCases.ts'

export type SharedRow = {
    case: string
    arms: Record<string, number>
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
        const arms: Record<string, number> = {}
        for (const name of Object.keys(kase.arms))
            arms[name] = (
                measured.samples[name] as { nanoseconds: number }
            ).nanoseconds
        rows.push({
            case: kase.name,
            arms,
            n: measured.n,
            floor: measured.floor,
            substrate: String(measured.substrate),
        })
    }
    return rows
}

/** Formats shared rows as text: each arm's nanoseconds and its ratio to the first arm. */
export function formatShared(rows: SharedRow[]): string {
    const lines: string[] = []
    for (const row of rows) {
        lines.push(
            `── ${row.case}   [n=${row.n} A/A floor=${(row.floor * 100).toFixed(2)}% ${row.substrate}]`,
        )
        const names = Object.keys(row.arms)
        const base = row.arms[names[0] as string] as number
        for (const name of names) {
            const ns = row.arms[name] as number
            lines.push(
                `  ${name.padEnd(34)} ${ns.toFixed(1).padStart(9)} ns   ${(ns / base).toFixed(3)}x`,
            )
        }
    }
    return lines.join('\n')
}
