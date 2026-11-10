import type { TestRow } from '@abide/harness/rows'
import type { runBenches } from '@abide/harness/runner'

/** What `scripts/exampleResults.ts` keeps for one chapter app, by file path below the app. */
export type ExampleResults = {
    ranAt: string
    tests: Record<string, TestRow>
    benches: Record<
        string,
        Omit<
            Awaited<ReturnType<typeof runBenches>>[number],
            'file' | 'name' | 'over'
        >
    >
}
