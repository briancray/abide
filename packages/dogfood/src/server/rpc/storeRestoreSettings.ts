import { GET, POST } from 'abide/server'
import { database } from '#server/storeRestoreDatabase'

export const readSetting = GET(({ name }: { name: string }) => {
    return database.settings.read(name)
})

export const writeSetting = POST((args: { name: string; value: string }) => {
    return database.settings.write(args.name, args.value)
})
