import { GET } from '@abide/abide/server'

import { exampleDirectory } from '#src/lib/exampleDirectory.server.ts'
import type { ExampleResults } from '#src/lib/ExampleResults.ts'

export default GET(
    async ({ path }: { path: string }) => {
        const crm = await exampleDirectory('crm')
        const kept = crm && Bun.file(`${crm}/.abide/results.json`)
        if (!kept || !(await kept.exists())) return null
        const results = (await kept.json()) as ExampleResults
        const bench = results.benches[path]
        if (bench !== undefined)
            return {
                kind: 'bench' as const,
                ranAt: results.ranAt,
                path,
                ...bench,
            }
        const test = results.tests[path]
        if (test !== undefined)
            return {
                kind: 'test' as const,
                ranAt: results.ranAt,
                path,
                cases: test.cases,
            }
        return null
    },
    {
        description:
            'What a CRM test or bench file last reported, by its path below the CRM, e.g. src/activity/lib/QuickLog.bench.ts: each case\'s pass or fail, or each arm\'s nanoseconds per op and the ratio claimed. null where it was never run. Use it for <show results="path"/>.',
    },
)
