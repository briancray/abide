/** How likely a deal at each stage is to close. */
const ODDS = { lead: 0.1, qualified: 0.3, proposal: 0.6, won: 1 }

type Stage = keyof typeof ODDS
export type Deal = { company: string; amount: number; stage: Stage }

const NEXT: Record<Stage, Stage> = {
    lead: 'qualified',
    qualified: 'proposal',
    proposal: 'won',
    won: 'won',
}

/** Every deal's amount, weighted by the odds of its stage. */
export function forecast(deals: Deal[]): number {
    let total = 0
    for (const deal of deals) total += deal.amount * ODDS[deal.stage]
    return Math.round(total)
}

/** The deals, with the one at `index` moved a stage on. */
export function advance(deals: Deal[], index: number): Deal[] {
    return deals.map((deal, at) =>
        at === index ? { ...deal, stage: NEXT[deal.stage] } : deal,
    )
}
