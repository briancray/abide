// The app data this example stands on.
//
// `computed` COUNTS THE COMPUTATIONS. Two tiles ask for the same range with no
// way to reach each other, and the claim is that this is ONE load — which is
// only visible in a figure that counts the work rather than in the two answers,
// which agree either way.

export type Metrics = { orders: number; average: string; computed: number }

const BY_RANGE: Record<string, { orders: number; average: string }> = {
    '7d': { orders: 128, average: '$84.10' },
    '30d': { orders: 512, average: '$79.40' },
}

let computed = 0

// A slow database, so the wait is on screen.
export const database = {
    metrics: {
        async forRange(range: string): Promise<Metrics> {
            await Bun.sleep(700)
            computed += 1
            const found = BY_RANGE[range] ?? { orders: 0, average: '$0.00' }
            return { orders: found.orders, average: found.average, computed }
        },
    },
}
