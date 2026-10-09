// The app data this example stands on.

type Contact = { initials: string; color: string; photoVersion: number }

const CONTACTS: Record<string, Contact> = {
    '4021': { initials: 'AL', color: '#2f8f83', photoVersion: 3 },
    '4022': { initials: 'GH', color: '#c4693d', photoVersion: 7 },
}

function contactOf(id: string): Contact {
    const contact = CONTACTS[id]
    if (contact === undefined) throw new Error(`no contact ${id}`)
    return contact
}

/** A contact's record, and the stored photo each version of it names. */
export const redirectAvatarDatabase = {
    contacts: {
        async find(id: string): Promise<Contact> {
            return contactOf(id)
        },
    },
    photos: {
        async find(id: string, version: number): Promise<Blob> {
            const { initials, color } = contactOf(id)
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${color}"/><text x="48" y="58" font-family="sans-serif" font-size="32" font-weight="600" fill="#fff" text-anchor="middle">${initials}</text><text x="48" y="84" font-family="monospace" font-size="10" fill="#fff" fill-opacity=".7" text-anchor="middle">v${version}</text></svg>`
            return new Blob([svg], { type: 'image/svg+xml' })
        },
    },
}
