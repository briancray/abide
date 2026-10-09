import { GET } from 'abide/server'

const BY_REGION: Record<string, number> = {
    n: 412,
    no: 412,
    nor: 128,
    nort: 128,
    north: 128,
}

export const countOrders = GET(
    async (args: { region: string }) => {
        // A slow service, so the wait is on screen.
        await Bun.sleep(450)
        return BY_REGION[args.region.toLowerCase()] ?? 0
    },
    { description: 'How many orders a region has.' },
)
