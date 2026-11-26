import { rpc } from '@abide/abide/server'

export default rpc(
    ({ phone }: { phone: string }) => {
        if (!/^[\d ]+$/.test(phone)) throw new Error('A phone is digits')
        return phone
    },
    { methods: ['POST'] },
)
