import type { TestRow } from '@abide/harness/rows'
import type { Bench } from '@abide/harness/runner'

/** What `scripts/exampleResults.ts` keeps for the CRM, by file path below the app. */
export type ExampleResults = {
    ranAt: string
    tests: Record<string, TestRow>
    benches: Record<string, Omit<Bench, 'file' | 'name' | 'over'>>
}
