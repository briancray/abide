// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
//
// A COUNTER PER SHELF, which is what the example's claim needs: refreshing a
// SLICE of the args space must reload east and leave west alone, and one
// counter over both cannot tell that from reloading everything.

export type Level = { onHand: number; loads: number }

const ON_HAND: Record<string, number> = { 'east/A-70': 12, 'west/A-70': 5 }
const loads: Record<string, number> = {}

export const database = {
    stock: {
        async find(warehouse: string, sku: string): Promise<Level> {
            const shelf = `${warehouse}/${sku}`
            loads[shelf] = (loads[shelf] ?? 0) + 1
            return { onHand: ON_HAND[shelf] ?? 0, loads: loads[shelf] }
        },
        async decrement(warehouse: string, sku: string): Promise<void> {
            const shelf = `${warehouse}/${sku}`
            ON_HAND[shelf] = (ON_HAND[shelf] ?? 0) - 1
        },
    },
}
