import { log, refuse, rpc } from '@abide/abide/server'

const mailer = log.named('mailer')

export default rpc(
    ({ id }: { id: string }) => {
        log(`statement for ${id} built`)
        mailer.error('550 mailbox full')
        return refuse(502, 'the mailer refused the statement')
    },
    { methods: ['POST'] },
)
