import { type Batched, claimOf, ratio } from '../report/index.ts'

const milliseconds = (nanoseconds: number) =>
    `${(nanoseconds / 1e6).toFixed(3)} ms`

/**
 * Every bench beside the code, `src/**\/*.bench.ts` under `root`, run in this process one after
 * another: each function a file exports is one bench, and its `CEILINGS` names the most each arm
 * may take, in milliseconds.
 *
 * `only` keeps the files whose path holds it.
 */
export async function runBenches(
    root: string,
    only?: string,
): Promise<
    {
        file: string
        name: string
        case: string
        n: number
        floor: number
        /** Nanoseconds per operation, by arm. */
        arms: Record<string, number>
        /** The last arm over the first, as the harness is allowed to say it; '' for one arm. */
        claim: string
        /** An arm over its ceiling, and a ceiling naming no arm. */
        over: string[]
    }[]
> {
    const base = root.endsWith('/') ? root : `${root}/`
    const files = [...new Bun.Glob('src/**/*.bench.ts').scanSync(base)].sort()
    const benches = []
    for (const file of files) {
        if (only !== undefined && !file.includes(only)) continue
        const { CEILINGS = {}, ...exported } = (await import(
            Bun.pathToFileURL(`${base}${file}`).href
        )) as {
            CEILINGS?: Record<string, Record<string, number>>
        } & Record<string, unknown>
        for (const [name, priced] of Object.entries(exported)) {
            if (typeof priced !== 'function') continue
            // `batch` keeps its A/A control out of `samples`, so every sample is an arm.
            const run = (priced as () => Batched)()
            const arms: Record<string, number> = {}
            const names = Object.keys(run.samples)
            for (const arm of names)
                arms[arm] = (
                    run.samples[arm] as Batched['samples'][string]
                ).nanoseconds
            const first = run.samples[names[0] ?? '']
            const last = run.samples[names[names.length - 1] ?? '']
            const over: string[] = []
            for (const [arm, most] of Object.entries(CEILINGS[name] ?? {})) {
                const took = arms[arm]
                if (took === undefined)
                    over.push(`no arm "${arm}" to hold to its ceiling`)
                else if (took / 1e6 > most)
                    over.push(
                        `${arm} took ${milliseconds(took)}, over its ceiling of ${most} ms`,
                    )
            }
            benches.push({
                file,
                name,
                case: run.case,
                n: run.n,
                floor: run.floor,
                arms,
                claim:
                    first && last && first !== last
                        ? `${last.arm} against ${first.arm}: ${claimOf(
                              ratio(last, first, { floor: run.floor }),
                          )}`
                        : '',
                over,
            })
        }
    }
    return benches
}
