import { rpc } from '@abide/abide/server'

const ACME = { stage: 'lead', amount: 12_000 }
const DEALS = [ACME, { stage: 'won', amount: 30_000 }]

export const getStage = rpc(async ({ stage }: { stage: string }) => {
    await Bun.sleep(400)
    let value = 0
    for (const deal of DEALS) if (deal.stage === stage) value += deal.amount
    return { value }
})

export const moveAcme = rpc(
    () => {
        ACME.stage = ACME.stage === 'lead' ? 'won' : 'lead'
    },
    { methods: ['POST'] },
)
