import { refuse } from '@abide/abide'
import { rpc } from '@abide/abide/server'

const nameTaken = refuse.named('NameTaken', {
    status: 409,
    message: 'A deal of that name is open.',
})

export const addDeal = rpc(
    ({ name }: { name: string }) =>
        name === 'Ledger audit' ? nameTaken() : { name },
    { methods: ['POST'] },
)
