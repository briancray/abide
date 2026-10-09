import { GET, reactive } from 'abide/server'
import { cacheCanonicalDatabase } from '#server/cacheCanonicalDatabase'

type Query = { range: string; region: string; compare?: string | undefined }

/** One entry per args key, and the key is the canonical wire form. */
const metricsFor = reactive((query: Query) =>
    cacheCanonicalDatabase.metrics.find(query),
)

export const getMetrics = GET(metricsFor, {
    description: 'Metrics for a range and a region.',
})
