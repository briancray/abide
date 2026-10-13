import { reactive } from '@abide/abide'
import { GET } from '@abide/abide/server'

const BY_RANGE: Record<string, { orders: number; average: string }> = {
    '7d': { orders: 128, average: '$84.10' },
    '30d': { orders: 512, average: '$79.40' },
}

// Counts the work: the two answers agree whether it was one load or two.
let computed = 0

/** Takes args, so it is keyed: one entry per args key, held. */
const metricsFor = reactive(async ({ range }: { range: string }) => {
    // A slow database, so the wait is on screen.
    await Bun.sleep(700)
    computed += 1
    const found = BY_RANGE[range] ?? { orders: 0, average: '$0.00' }
    return { orders: found.orders, average: found.average, computed }
})

export default GET(metricsFor, {
    description: 'Metrics for a range.',
})
