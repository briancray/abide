import { GET } from 'belte/route'
import { json } from 'belte/respond'
import { counterState } from '../counterState.ts'

export const getCounter = GET<undefined, { count: number }>(() =>
    json({ count: counterState.count }),
)
