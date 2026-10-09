// The app data this example stands on.

export type Contact = { name: string; phone: string; tags: string[] }

const DEFAULT_TAGS = ['customer', 'newsletter', 'vip']

const contact: Contact = {
    name: 'Ada Lovelace',
    phone: '020 7946 0018',
    tags: [...DEFAULT_TAGS],
}

/** One contact, written three ways. */
export const writeMethodsDatabase = {
    contacts: {
        async find(_id: string): Promise<Contact> {
            await Bun.sleep(300)
            return { ...contact, tags: [...contact.tags] }
        },
        async update(_id: string, change: Partial<Contact>): Promise<Contact> {
            await Bun.sleep(300)
            Object.assign(contact, change)
            return { ...contact, tags: [...contact.tags] }
        },
    },
}
