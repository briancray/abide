import type { TestRow } from '@abide/harness/rows'

/** What `scripts/exampleResults.ts` keeps for one chapter app, by file path below the app. */
export type ExampleResults = {
    ranAt: string
    tests: Record<string, TestRow>
    benches: Record<
        string,
        {
            case: string
            n: number
            floor: number
            /** Nanoseconds per operation, by arm. */
            arms: Record<string, number>
            /** The last arm over the first, as the harness is allowed to say it. */
            claim: string
        }
    >
}
