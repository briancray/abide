import { GET, memo } from 'abide/server'
import { database } from '#server/database'

type Range = { range: string }

// TAKES ARGS, so it is keyed: one entry per args key, computed on
// the first read of that key and held.
const metricsFor = memo(({ range }: Range) => database.metrics.forRange(range))

export const getMetrics = GET(metricsFor)
