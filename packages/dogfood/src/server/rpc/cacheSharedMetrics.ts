import { GET, reactive } from 'abide/server'
import { database } from '#server/cacheSharedDatabase'

type Range = { range: string }

/** Takes args, so it is keyed: one entry per args key, held. */
const metricsFor = reactive(({ range }: Range) =>
    database.metrics.forRange(range),
)

export const getMetrics = GET(metricsFor)
