import { log } from '@abide/abide'

/** The billing service: handed a contact id, and nothing else. */
export const billing = {
    async notify(contact: string): Promise<void> {
        await Bun.sleep(150)
        log(`billing told about contact ${contact}`)
    },
}
