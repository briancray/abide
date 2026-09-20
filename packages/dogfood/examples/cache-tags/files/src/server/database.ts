// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
//
// TWO COUNTERS, NOT ONE, because the example invalidates by a tag that names
// the ROW: reloading `region:north` must move north's figures and leave south's
// where they are. A single shared counter would go up for either region and
// prove nothing about which entry was dropped.

export type Totals = { revenue: string; computed: number }
export type Orders = { count: number; loaded: number }

const REVENUE: Record<string, string> = {
    north: '$12,480.00',
    south: '$9,140.00',
}
const COUNT: Record<string, number> = { north: 128, south: 94 }

const computed: Record<string, number> = { north: 0, south: 0 }
const loaded: Record<string, number> = { north: 0, south: 0 }

export const database = {
    metrics: {
        async totals({ region }: { region: string }): Promise<Totals> {
            computed[region] = (computed[region] ?? 0) + 1
            return {
                revenue: REVENUE[region] ?? '$0.00',
                computed: computed[region],
            }
        },
    },
    orders: {
        async recent({ region }: { region: string }): Promise<Orders> {
            loaded[region] = (loaded[region] ?? 0) + 1
            return { count: COUNT[region] ?? 0, loaded: loaded[region] }
        },
    },
}
