import { GET } from '@abide/abide/server'

const INVOICES = [
    { number: 'INV-4019', customer: 'Hopper & Co', daysOverdue: 42 },
    { number: 'INV-4020', customer: 'Analytical Engines Ltd', daysOverdue: 12 },
]

export default GET(
    ({ days }: { days: number }) =>
        INVOICES.filter((invoice) => invoice.daysOverdue >= days),
    { description: 'The invoices overdue by at least `days` days.' },
)
