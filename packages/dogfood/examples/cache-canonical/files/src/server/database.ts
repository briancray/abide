// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
//
// `computed` COUNTS THE COMPUTATIONS, and it is the whole instrument: three
// spellings of one query reach one entry, and the orders figure is the same
// either way — so a number that only moves when work actually happened is the
// one thing on the page that can tell them apart.

export type Metrics = { orders: number; computed: number }

type Query = { range: string; region: string; compare?: string }

const ORDERS: Record<string, number> = { north: 128, south: 94 }

let computed = 0

export const database = {
    metrics: {
        async find(query: Query): Promise<Metrics> {
            computed += 1
            return { orders: ORDERS[query.region] ?? 0, computed }
        },
    },
}
