// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
//
// `counted` COUNTS THE COUNTS. Marking a shelf stale and reloading it now are
// two different triggers with the same answer on the page, so the figure that
// separates them is the one saying how many times the shelf was actually
// walked.

export type Level = { onHand: number; counted: number }

let counted = 0

export const database = {
    stock: {
        async find(_warehouse: string, _sku: string): Promise<Level> {
            counted += 1
            return { onHand: 12, counted }
        },
    },
}
