import { log, refuse } from '@abide/abide'
import { rpc } from '@abide/abide/server'

const mailer = log.named('mailer')

/** Answers at /ops/sendStatement: the mailer is down, so it never sends. */
export const sendStatement = rpc(
    ({ id }: { id: string }) => {
        log(`statement for ${id} built`)
        mailer.error('550 mailbox full')
        return refuse(502, 'the mailer refused the statement')
    },
    { methods: ['POST'], description: 'Emails a contact their statement.' },
)
