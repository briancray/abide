import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { counterState } from '../../counterState.ts'

export const getCounter = GET(() => json({ count: counterState.count }))
