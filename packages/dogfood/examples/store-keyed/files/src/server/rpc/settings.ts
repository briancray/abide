import { GET } from 'abide/server'
import { settings } from '#server/cache'

export const getSettings = GET(settings)
