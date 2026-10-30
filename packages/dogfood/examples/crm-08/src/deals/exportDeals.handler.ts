import { GET } from '@abide/abide/server'
import { DEALS } from './lib/DEALS.server.ts'

/** A Blob answers with its own type: this one is a CSV file. */
export default GET(
    () => {
        const lines = ['name,amount,stage']
        for (const deal of DEALS)
            lines.push(`${deal.name},${deal.amount},${deal.stage}`)
        return new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' })
    },
    { description: 'Every deal, as a CSV file.' },
)
