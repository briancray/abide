import { log, POST, refuse } from '@abide/abide/server'

const mailer = log.named('mailer')

/** Answers at /ops/sendStatement: the mailer is down, so it never sends. */
export default POST(
    ({ id }: { id: string }) => {
        log(`statement for ${id} built`)
        mailer.error('550 mailbox full')
        return refuse(502, 'the mailer refused the statement')
    },
    { description: 'Emails a contact their statement.' },
)
