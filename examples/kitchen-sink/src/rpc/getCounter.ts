import { GET } from 'belte/rpc'
import { json } from 'belte/response'
import { counterState } from '../counterState.ts'

export const getCounter = GET<undefined, { count: number }>(() =>
    json({ count: counterState.count }),
)
