// The app data this example stands on.
//
// THREE ROWS, ONE PER OUTCOME, because the example is about narrowing an error
// to the failure it actually is: one row answers, one is somebody else's, one
// has been replaced. Two rows could not tell the second refusal from the first.

export type Invoice = {
    total: string
    mine: boolean
    owner: string
    replacedBy: string
}

const INVOICES: Record<string, Invoice> = {
    '4310': { total: '$1,240.00', mine: true, owner: 'ada', replacedBy: '' },
    '4311': { total: '$96.00', mine: false, owner: 'grace', replacedBy: '' },
    '4312': { total: '$512.00', mine: true, owner: 'ada', replacedBy: '4313' },
}

/** A slow database, so the wait is on screen. */
export const refuseNarrowedDatabase = {
    invoices: {
        async find(id: string): Promise<Invoice> {
            await Bun.sleep(450)
            const row = INVOICES[id]
            if (row === undefined) throw new Error(`no row ${id}`)
            return row
        },
    },
}
