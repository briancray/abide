import { log, onStart } from 'abide/server'

onStart(async (start) => {
    await start()
    log('started')
})
