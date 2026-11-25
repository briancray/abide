import { GET } from '@abide/abide/server'

import { exampleResults } from '#src/lib/exampleDirectory.server.ts'

export default GET(
    async ({ path }: { path: string }) => {
        const results = await exampleResults()
        if (results === null) return null
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
            'What a CRM test or bench file last reported, by its path below the CRM, e.g. src/activity/lib/QuickLog.bench.ts: each case\'s pass or fail, or each arm\'s nanoseconds per op and the ratio claimed. null where it was never run. Use it for a ```show results="path"``` block.',
    },
)
