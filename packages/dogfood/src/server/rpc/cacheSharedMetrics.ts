import { GET, reactive } from 'abide/server'
import { database } from '#server/cacheSharedDatabase'

type Range = { range: string }

// TAKES ARGS, so it is keyed: one entry per args key, computed on
// the first read of that key and held.
const metricsFor = reactive(({ range }: Range) =>
    database.metrics.forRange(range),
)

export const getMetrics = GET(metricsFor)
