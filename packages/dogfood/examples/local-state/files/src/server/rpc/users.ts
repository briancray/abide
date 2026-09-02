import { GET } from 'abide/server'

export const getProfile = GET(async () => ({
    name: 'Ada Lovelace',
    handle: 'ada',
}))
