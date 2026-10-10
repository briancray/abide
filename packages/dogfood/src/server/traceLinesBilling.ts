import { log } from '@abide/abide/server'

/** Another module the sync reaches, handed the contact and nothing else. */
export const traceLinesBilling = {
    async notify(contact: string): Promise<void> {
        await Bun.sleep(150)
        log(`billing told about contact ${contact}`)
    },
}
