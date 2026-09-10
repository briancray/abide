import { GET } from 'abide/server'
import { database } from '#server/database'

// The address comes off the file path and the export name, and the
// schemas off the annotations already here.
export const getInvoice = GET(({ id }: { id: string }) => {
    return database.invoices.find(id)
})
