import { GET } from 'abide/server'
import { database } from '#server/probeErrorDatabase'
import { notReachable } from '#shared/probeErrorFailures'

export const getInvoice = GET(async ({ id }: { id: string }) => {
    const found = await database.invoices.find(id)
    if (found === null) return notReachable({ id })
    return found
})
