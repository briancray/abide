// The app data this example stands on.
//
// `counted` COUNTS THE COUNTS. Marking a shelf stale and reloading it now are
// two different triggers with the same answer on the page, so the figure that
// separates them is the one saying how many times the shelf was actually
// walked.

export type Level = { onHand: number; counted: number }

let counted = 0

/** A slow database, so the wait is on screen. */
export const database = {
    stock: {
        async find(_warehouse: string, _sku: string): Promise<Level> {
            await Bun.sleep(600)
            counted += 1
            return { onHand: 12, counted }
        },
    },
}
