// The app data this example stands on.

export type Settings = { theme: string }

const BY_PROFILE: Record<string, Settings> = {
    ada: { theme: 'dark' },
    grace: { theme: 'light' },
}

/** A slow database, so the wait is on screen. */
export const storeKeyedDatabase = {
    settings: {
        async forProfile(profile: string): Promise<Settings> {
            await Bun.sleep(450)
            return BY_PROFILE[profile] ?? { theme: 'dark' }
        },
    },
}
