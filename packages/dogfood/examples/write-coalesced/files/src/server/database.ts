// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
//
// `payments` COUNTS THE WRITES THAT LANDED, which is the figure the example is
// about: a button pressed faster than the round trip must not bill twice, and a
// total that never moves cannot say whether it did.

export type Payment = { payments: number }

let payments = 0

export const database = {
    invoices: {
        async pay(_id: string): Promise<Payment> {
            payments += 1
            return { payments }
        },
    },
}
