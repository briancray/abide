// The app data this example stands on.

const INVOICES = {
    '4021': {
        number: 'INV-4021',
        customer: 'Analytical Engines Ltd',
        due: '2026-10-14',
        lines: [
            { item: 'Annual licence', amount: '$1,000.00' },
            { item: 'Onboarding', amount: '$240.00' },
        ],
        total: '$1,240.00',
    },
    '4022': {
        number: 'INV-4022',
        customer: 'Hopper & Co',
        due: '2026-10-21',
        lines: [
            { item: 'Seats × 12', amount: '$720.00' },
            { item: 'Priority support', amount: '$180.00' },
        ],
        total: '$900.00',
    },
}

/** A slow database, so the wait is on screen. */
export const renderPreviewDatabase = {
    invoices: {
        async find(id: string) {
            await Bun.sleep(300)
            const invoice = INVOICES[id as keyof typeof INVOICES]
            if (invoice === undefined) throw new Error(`no invoice ${id}`)
            return invoice
        },
    },
}
