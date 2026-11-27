import { refuse } from '@abide/abide'
import { rpc } from '@abide/abide/server'

export const savePhone = rpc(
    ({ phone }: { phone: string }) => {
        const digits = phone.replace(/\D/g, '')
        if (digits.length < 7)
            return refuse(400, 'A phone number needs at least seven digits.')
        return { phone: digits }
    },
    { methods: ['POST'] },
)
