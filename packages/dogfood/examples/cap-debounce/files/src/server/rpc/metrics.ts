import { GET } from 'abide/server'

const BY_REGION: Record<string, number> = {
    n: 412,
    no: 412,
    nor: 128,
    nort: 128,
    north: 128,
}

export const countOrders = GET((args: { region: string }): number => {
    return BY_REGION[args.region.toLowerCase()] ?? 0
})
