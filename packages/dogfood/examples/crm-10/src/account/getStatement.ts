import { GET } from '@abide/abide/server'

/** Read from the bookkeeping partner's own pages, and from no one else's. */
export default GET(() => ({ account: 'A-1042', balance: '$2,140.00' }), {
    crossOrigin: ['https://books.example'],
    description: 'An account statement, for the bookkeeping partner.',
})
