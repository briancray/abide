// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
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

export const database = {
    invoices: {
        async find(id: string): Promise<Invoice> {
            return INVOICES[id]
        },
    },
}
