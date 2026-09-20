// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
//
// `loads` IS THE LAPSE, MADE VISIBLE. Nothing wakes when a ttl runs out — the
// next READ is what recomputes — so a page that only showed the level could not
// tell a lapse from a cache hit.

export type Level = { onHand: number; loads: number }

let loads = 0

export const database = {
    stock: {
        async find(_warehouse: string, _sku: string): Promise<Level> {
            loads += 1
            return { onHand: 12, loads }
        },
    },
}
