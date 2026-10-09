// The records `onPrincipal` resolves a sealed id against.

export type User = { id: string; name: string; role: string }

const USERS: Record<string, User> = {
    ada: { id: 'ada', name: 'Ada Lovelace', role: 'admin' },
    grace: { id: 'grace', name: 'Grace Hopper', role: 'sales' },
}

export const principalResolveDatabase = {
    users: {
        async find(id: string): Promise<User | undefined> {
            await Bun.sleep(150)
            return USERS[id]
        },
    },
}
