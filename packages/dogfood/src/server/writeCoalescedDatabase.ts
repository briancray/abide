// The app data this example stands on.
//
// `payments` COUNTS THE WRITES THAT LANDED, which is the figure the example is
// about: a button pressed faster than the round trip must not bill twice, and a
// total that never moves cannot say whether it did.

export type Payment = { payments: number }

let payments = 0

// A slow database, so the wait is on screen.
export const database = {
    invoices: {
        async pay(_id: string): Promise<Payment> {
            await Bun.sleep(1500)
            payments += 1
            return { payments }
        },
    },
}
