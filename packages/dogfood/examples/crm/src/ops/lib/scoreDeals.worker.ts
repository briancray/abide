import { DEALS } from '../../pipeline/lib/DEALS.server.ts'

/** Scores every deal, yielding each score as it lands. */
export async function* scoreDeals(): AsyncGenerator<{
    name: string
    score: number
}> {
    for (const deal of DEALS) {
        let score = 0
        for (let round = 0; round < 5_000_000; round += 1)
            score = (score * 31 + deal.amount + round) % 100
        yield { name: deal.name, score }
    }
}
