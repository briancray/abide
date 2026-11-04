import { log } from '@abide/abide'
import { trace } from '@abide/abide/server'

/** The billing service: handed a contact id, and nothing else. */
export const billing = {
    async notify(contact: string): Promise<void> {
        // A line with its duration, and `billing` in the server-timing header.
        await trace.span('billing', () => Bun.sleep(150), { timing: true })
        log(`billing told about contact ${contact}`)
    },
}
