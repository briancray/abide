import { GET, json } from 'abide/server'
import { jsonNullDatabase } from '#server/jsonNullDatabase'

export const accountManager = GET(
    async ({ id }: { id: string }) =>
        json(await jsonNullDatabase.contacts.managerOf(id)),
    { description: 'The account manager of a contact, or null.' },
)
