import { DELETE, GET, PATCH, PUT } from '@abide/abide/server'
import { writeMethodsDatabase } from '#server/writeMethodsDatabase'

const contacts = writeMethodsDatabase.contacts

export const getContact = GET(({ id }: { id: string }) => contacts.find(id), {
    description: 'A contact, by id.',
})

export const updatePhone = PATCH(
    ({ id, phone }: { id: string; phone: string }) =>
        contacts.update(id, { phone }),
    { description: 'Changes the phone of a contact.' },
)

export const replaceTags = PUT(
    ({ id, tags }: { id: string; tags: string[] }) =>
        contacts.update(id, { tags }),
    { description: 'Replaces the tags of a contact.' },
)

export const removeTag = DELETE(
    async ({ id, tag }: { id: string; tag: string }) => {
        const { tags } = await contacts.find(id)
        return contacts.update(id, {
            tags: tags.filter((each) => each !== tag),
        })
    },
    { description: 'Removes one tag from a contact.' },
)
