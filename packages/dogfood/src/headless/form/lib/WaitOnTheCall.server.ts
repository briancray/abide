import { rpc } from '@abide/abide/server'

export default rpc(
    async ({ name }: { name: string }) => {
        await Bun.sleep(1_500)
        return { name }
    },
    { methods: ['POST'] },
)
