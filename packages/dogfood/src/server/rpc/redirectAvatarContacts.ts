import { GET, redirect } from 'abide/server'
import { redirectAvatarDatabase } from '#server/redirectAvatarDatabase'

export const photo = GET(
    ({ id, version }: { id: string; version: number }) =>
        redirectAvatarDatabase.photos.find(id, version),
    { description: 'A contact photo, by id and version.' },
)

export const avatar = GET(
    async ({ id }: { id: string }) => {
        const contact = await redirectAvatarDatabase.contacts.find(id)
        return redirect(photo.url({ id, version: contact.photoVersion }))
    },
    { description: 'Redirects to the current photo of a contact.' },
)
