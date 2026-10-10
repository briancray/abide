import { log, onStart } from '@abide/abide/server'

onStart(async (start) => {
    await start()
    log('started')
})
