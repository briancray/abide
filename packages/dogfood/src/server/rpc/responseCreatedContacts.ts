import { POST, response } from 'abide/server'
import { responseCreatedDatabase } from '#server/responseCreatedDatabase'

export const addContact = POST(
    async ({ name }: { name: string }) => {
        const contact = await responseCreatedDatabase.contacts.add(name)
        response().status = 201
        response().headers.set('location', `/contacts/${contact.id}`)
        return contact
    },
    { description: 'Adds a contact, and answers 201 with where it lives.' },
)
