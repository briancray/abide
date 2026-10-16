import { GET } from '@abide/abide/server'
import { CONTACTS } from './server/CONTACTS.ts'

export default GET(async () => {
    // A slow database, so the wait is on screen.
    await Bun.sleep(400)
    return CONTACTS
})
