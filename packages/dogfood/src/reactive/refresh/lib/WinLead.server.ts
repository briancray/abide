import { rpc } from '@abide/abide/server'

const ACME = { stage: 'lead', amount: 12_000 }
const DEALS = [
    ACME,
    { stage: 'won', amount: 30_000 },
    { stage: 'proposal', amount: 9_000 },
]

export const getStage = rpc(async ({ stage }: { stage: string }) => {
    await Bun.sleep(400)
    let value = 0
    for (const deal of DEALS) if (deal.stage === stage) value += deal.amount
    return value
})

export const winDeal = rpc(
    () => {
        ACME.stage = ACME.stage === 'lead' ? 'won' : 'lead'
    },
    { methods: ['POST'] },
)
