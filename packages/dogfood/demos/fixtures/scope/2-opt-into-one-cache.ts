import { memo } from 'abide'

/**
 * `{ global }` — one cache for the whole process.
 *
 * Correct here because the answer does not depend on who asked: a currency table is the same table for
 * everybody, and a per-caller cache would fetch it once per request forever.
 */
export const currencies = memo(
    async () => {
        const answered = await fetch('https://rates.test/table')
        return (await answered.json()) as Record<string, number>
    },
    { global: true },
)
