import { GET } from '@abide/abide/server'

const BY_REGION: Record<string, { week: string; total: string }[]> = {
    north: [
        { week: 'week 1', total: '$3,120.00' },
        { week: 'week 2', total: '$2,980.00' },
    ],
    south: [{ week: 'week 1', total: '$2,140.00' }],
}

/** A row every 300 ms; the bound is on each row, not the whole report. */
export default GET(
    async function* ({ region }: { region: string }) {
        for (const row of BY_REGION[region] ?? []) {
            await Bun.sleep(300)
            yield row
        }
        // South stops producing after its first row.
        if (region === 'south') await Bun.sleep(2_000)
    },
    { timeout: 500, description: 'Sales for a region, a row at a time.' },
)
