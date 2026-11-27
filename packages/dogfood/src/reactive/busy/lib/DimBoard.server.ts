import { rpc } from '@abide/abide/server'

const COUNTS: Record<string, number> = { lead: 3, won: 2 }

export const getStage = rpc(
    async ({ stage }: { stage: string }) => {
        await Bun.sleep(600)
        return COUNTS[stage] ?? 0
    },
    { tags: ['board'] },
)
