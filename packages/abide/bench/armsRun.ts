// Runs bench cases through the one batcher, in whichever engine loaded it: every arm against the
// first, which is the A/A control too (43.7), and the work each did, where a case counts it, checked
// against what its ratio claims.
import {
    batch,
    type BatchSpec,
    claimOf,
    emulatedDom,
    ratio,
    type Sample,
} from '@abide/harness/report'

/** One case: its arms in order, the first the base, and optionally what it is for and the work each does. */
export type ArmsCase = {
    name: string
    /** What the case is FOR: a case earns its place by distinguishing implementations. */
    distinguishes?: string | undefined
    arms: Record<string, () => void>
    /** Work counts per arm, taken in a pass apart from the timed one over the same closures. */
    work?: (() => Record<string, Record<string, number>>) | undefined
}

/** One case's reading: each arm in nanoseconds per op, its claim against the first, and the work. */
export type ArmsRow = {
    case: string
    distinguishes: string | undefined
    arms: Record<string, number>
    claims: Record<string, string>
    n: number
    reps: number
    floor: number
    substrate: string
    work: Record<string, Record<string, number>> | undefined
    workDisagreement: string[]
}

/** What a browser injectable hands the page: the cases it was built over, run at a budget. */
export type ArmsBench = (
    budgetNanoseconds: number,
    sizing?: Pick<BatchSpec, 'reps' | 'warmup'>,
) => ArmsRow[]

/** Batches every case and returns one row per case. */
export function runArms(
    cases: readonly ArmsCase[],
    budgetNanoseconds: number,
    sizing?: Pick<BatchSpec, 'reps' | 'warmup'>,
): ArmsRow[] {
    const rows: ArmsRow[] = []
    for (const kase of cases) {
        const measured = batch({
            case: kase.name,
            arms: kase.arms,
            emulated: emulatedDom(),
            budgetNanoseconds,
            ...sizing,
        })
        const work = kase.work?.()
        const names = Object.keys(kase.arms)
        const sampleOf = (name: string): Sample => ({
            ...(measured.samples[name] as Sample),
            work: work?.[name],
        })
        const base = sampleOf(names[0] as string)
        const arms: Record<string, number> = {}
        const claims: Record<string, string> = {}
        const workDisagreement: string[] = []
        for (const name of names) {
            const sample = name === names[0] ? base : sampleOf(name)
            arms[name] = sample.nanoseconds
            if (sample === base) {
                claims[name] = 'base'
                continue
            }
            const result = ratio(sample, base, { floor: measured.floor })
            claims[name] = claimOf(result)
            workDisagreement.push(...result.workDisagreement)
        }
        rows.push({
            case: kase.name,
            distinguishes: kase.distinguishes,
            arms,
            claims,
            n: measured.n,
            reps: measured.reps,
            floor: measured.floor,
            substrate: String(measured.substrate),
            work,
            workDisagreement,
        })
    }
    return rows
}

/** The rows as every lane prints them: each arm's nanoseconds and claim, and whether the work agrees. */
export function formatArms(rows: readonly ArmsRow[]): string {
    const lines: string[] = []
    for (const row of rows) {
        lines.push(
            `── ${row.case}   [n=${row.n} reps=${row.reps} A/A floor=${(row.floor * 100).toFixed(2)}% ${row.substrate}]`,
        )
        if (row.distinguishes !== undefined)
            lines.push(`  distinguishes: ${row.distinguishes}`)
        for (const name of Object.keys(row.arms)) {
            const ns = row.arms[name] as number
            lines.push(
                `  ${name.padEnd(34)} ${ns.toFixed(1).padStart(9)} ns   ${row.claims[name]}`,
            )
        }
        if (row.workDisagreement.length > 0)
            lines.push(
                `  WORK DISAGREES — ${row.workDisagreement.join('; ')}\n  The arms are not doing the same job, so the ratio prices two different jobs.`,
            )
        else if (row.work !== undefined)
            lines.push(`  work agrees: ${JSON.stringify(row.work)}`)
        lines.push('')
    }
    return lines.join('\n')
}
