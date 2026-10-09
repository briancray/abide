// The app data this example stands on.
//
// `loads` IS THE LAPSE, MADE VISIBLE. Nothing wakes when a ttl runs out — the
// next READ is what recomputes — so a page that only showed the level could not
// tell a lapse from a cache hit.

export type Level = { onHand: number; loads: number }

let loads = 0

/** A slow database, so the wait is on screen. */
export const reloadTtlDatabase = {
    stock: {
        async find(_warehouse: string, _sku: string): Promise<Level> {
            await Bun.sleep(450)
            loads += 1
            return { onHand: 12, loads }
        },
    },
}
