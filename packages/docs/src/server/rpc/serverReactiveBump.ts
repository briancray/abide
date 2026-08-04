import { POST } from 'abide/server/POST'
import { doubled, total, watchFires } from '$shared/serverReactive'

// A DIFFERENT server module imports the shared `state` and writes it. The write propagates through the
// derived `doubled` and fires the `watch` back in serverReactive.ts — cross-module server reactivity.
// Returns the fresh snapshot (a mutation's return is authoritative and uncached).
export default POST(({ by = 1 }: { by?: number }) => {
    total.set(total.peek() + by)
    return { total: total.peek(), doubled: doubled.live(), fires: watchFires() }
})
