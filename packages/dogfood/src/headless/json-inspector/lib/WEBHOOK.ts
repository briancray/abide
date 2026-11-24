// What billing posted when Hopper & Co paid its November invoice: the payload Operations opens to see
// what a sync was told.
export const WEBHOOK = {
    id: 'evt_1042',
    type: 'invoice.paid',
    live: true,
    invoice: {
        number: 'INV-2026-0311',
        company: { id: 'hopper', name: 'Hopper & Co', city: 'London' },
        total: 4800,
        currency: 'GBP',
        lines: [
            { description: 'Seats, November', quantity: 12, amount: 3600 },
            { description: 'Priority support', quantity: 1, amount: 1200 },
        ],
        paidBy: { name: 'Grace Hopper', email: 'grace@hopper.example' },
        coupon: null,
    },
    metadata: { 'crm/account': 'hopper' },
}
