import { GET } from 'abide/server'
import { database } from '#server/database'
import { notReachable } from '#shared/failures'

export const getInvoice = GET(async ({ id }: { id: string }) => {
    const found = await database.invoices.find(id)
    if (found === null) return notReachable({ id })
    return found
})
