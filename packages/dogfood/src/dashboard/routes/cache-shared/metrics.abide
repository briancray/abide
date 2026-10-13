import { GET, reactive } from '@abide/abide/server'
import { cacheSharedDatabase } from '#server/cacheSharedDatabase'

/** Takes args, so it is keyed: one entry per args key, held. */
const metricsFor = reactive(({ range }: { range: string }) =>
    cacheSharedDatabase.metrics.forRange(range),
)

export const getMetrics = GET(metricsFor, {
    description: 'Metrics for a range.',
})
