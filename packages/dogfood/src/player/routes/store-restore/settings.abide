import { GET, POST } from '@abide/abide/server'
import { storeRestoreDatabase } from '#server/storeRestoreDatabase'

export const readSetting = GET(
    ({ name }: { name: string }) => {
        return storeRestoreDatabase.settings.read(name)
    },
    { description: 'A setting, by name.' },
)

export const writeSetting = POST(
    (args: { name: string; value: string }) => {
        return storeRestoreDatabase.settings.write(args.name, args.value)
    },
    { description: 'Writes a setting.' },
)
