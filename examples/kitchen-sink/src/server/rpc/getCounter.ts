import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { counterState } from '../../counterState.ts'

export const getCounter = GET(() => json({ count: counterState.count }))
