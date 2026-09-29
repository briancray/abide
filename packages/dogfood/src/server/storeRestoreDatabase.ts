// The app data this example stands on.
//
// `null` IS THE MISS, and `settingsStore` reads it as one — a setting never
// written is not the same as a setting written as `null`, which is what the
// store's `get` turns into `undefined` so the reactive keeps the initial value
// it was declared with.

const SETTINGS = new Map<string, string>()

/** A slow database, so the wait is on screen. */
export const database = {
    settings: {
        async read(name: string): Promise<string | null> {
            await Bun.sleep(450)
            return SETTINGS.get(name) ?? null
        },
        async write(name: string, value: string): Promise<void> {
            SETTINGS.set(name, value)
        },
    },
}
