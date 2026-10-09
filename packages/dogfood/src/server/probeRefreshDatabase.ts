// The app data this example stands on.
//
// `sent` COUNTS THE LOADS, which is what makes a refresh visible: the total
// does not move, so a value that came back from the cache and a value that was
// fetched again read identically without a figure that changes on the fetch
// alone.

export type Invoice = { total: string; sent: number }

let sent = 0

/** A slow database, so the wait is on screen. */
export const probeRefreshDatabase = {
    invoices: {
        async find(_id: string): Promise<Invoice> {
            await Bun.sleep(900)
            sent += 1
            return { total: '$1,240.00', sent }
        },
    },
}
