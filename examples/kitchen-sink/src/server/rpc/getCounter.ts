import { json } from 'belte/server'
import { GET } from 'belte/server'
import { counterState } from '../../counterState.ts'

export const getCounter = GET(() => json({ count: counterState.count }))
