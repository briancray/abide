import { GET, POST, reactive } from 'abide/server'

const STAGES = ['lead', 'qualified', 'proposal', 'won']

// One pipeline for the whole process, so every browser reads the same one.
const pipeline = reactive(
    [
        { id: 'acme', name: 'Acme Corp', stage: 'lead' },
        { id: 'globex', name: 'Globex', stage: 'proposal' },
    ],
    { global: true },
)

export const openDeals = GET(pipeline)

export const advanceDeal = POST(({ id }: { id: string }) => {
    pipeline.patch((deals) => {
        const deal = deals.find((each) => each.id === id)
        if (deal === undefined) return
        const next = (STAGES.indexOf(deal.stage) + 1) % STAGES.length
        deal.stage = STAGES[next] as string
    })
})
