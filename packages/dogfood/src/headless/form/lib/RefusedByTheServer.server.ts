import { refuse } from '@abide/abide'
import { rpc } from '@abide/abide/server'

const TAKEN = ['Ledger audit']

export const addDeal = rpc(
    ({ name }: { name: string }) =>
        TAKEN.includes(name)
            ? refuse.validation<{ name: string }>({ name: ['is taken'] })
            : { name },
    { methods: ['POST'] },
)
