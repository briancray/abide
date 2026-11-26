import { rpc } from '@abide/abide/server'

import { CONTACTS } from './lib/CONTACTS.server.ts'

export default rpc(async () => {
    // A slow database, so the wait is on screen.
    await Bun.sleep(400)
    return CONTACTS
})
