// The app data this example stands on.
//
// `computed` COUNTS THE COMPUTATIONS, and it is the whole instrument: three
// spellings of one query reach one entry, and the orders figure is the same
// either way — so a number that only moves when work actually happened is the
// one thing on the page that can tell them apart.

export type Metrics = { orders: number; computed: number }

type Query = { range: string; region: string; compare?: string }

const ORDERS: Record<string, number> = { north: 128, south: 94 }

let computed = 0

// A slow database, so the wait is on screen.
export const database = {
    metrics: {
        async find(query: Query): Promise<Metrics> {
            await Bun.sleep(700)
            computed += 1
            return { orders: ORDERS[query.region] ?? 0, computed }
        },
    },
}
