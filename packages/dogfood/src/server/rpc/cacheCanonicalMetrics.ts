import { GET, reactive } from 'abide/server'
import { database } from '#server/cacheCanonicalDatabase'

type Query = { range: string; region: string; compare?: string }

// One entry per ARGS KEY, and the key is the canonical wire form:
// sorted, `undefined` dropped, `Date` written ISO.
const metricsFor = reactive((query: Query) => database.metrics.find(query))

export const getMetrics = GET(metricsFor)
