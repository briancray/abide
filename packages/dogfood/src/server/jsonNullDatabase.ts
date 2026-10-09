// The app data this example stands on.

export type Manager = { name: string }

const MANAGERS: Record<string, Manager | undefined> = {
    '4021': { name: 'Charles Babbage' },
    '4022': undefined,
}

/** A slow database, so the wait is on screen. */
export const jsonNullDatabase = {
    contacts: {
        async managerOf(id: string): Promise<Manager | undefined> {
            await Bun.sleep(300)
            return MANAGERS[id]
        },
    },
}
