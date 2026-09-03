import { GET, memo } from 'abide/server'
import { database } from '#server/database'

const matches = memo(
    ({ q }: { q: string }) => database.invoice.search(q),
    { ttl: 30_000 },
)

// The other shape: fire immediately, then at most once per window.
// Right where the first update should be instant and the RATE is
// the problem — and it caps revalidation HOWEVER it was triggered,
// a dependency moving, an `invalidate`, a `refresh`, a `ttl`.
const openCount = memo(() => database.invoice.countOpen(), {
    throttle: 1_000,
})

// A `Map` is one of the shapes `structural` BAILS on, and a bail
// is "not equal" — so left at the default this wakes every reader
// on every recompute. The two-argument form is what an app whose
// values it declines to decide passes instead.
const facets = memo(({ q }: { q: string }) => database.invoice.facets(q), {
    identity: (
        next: Map<string, number>,
        previous: Map<string, number>,
    ) => {
        if (next.size !== previous.size) return false
        for (const [name, count] of next) {
            if (previous.get(name) !== count) return false
        }
        return true
    },
})

export const search = GET(matches)
export const countOpen = GET(openCount)
export const searchFacets = GET(facets)
