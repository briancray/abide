import { GET } from 'abide/server'
import { oneTypeDatabase } from '#server/oneTypeDatabase'

export const getContact = GET(
    ({ id }: { id: string }) => oneTypeDatabase.contacts.find(id),
    { description: 'A contact, by id.' },
)
