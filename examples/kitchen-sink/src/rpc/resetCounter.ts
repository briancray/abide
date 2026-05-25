import { DELETE } from 'belte/rpc'
import { json } from 'belte/response'
import { counterState } from '../counterState.ts'

export const resetCounter = DELETE<undefined, { count: number }>(() => {
    counterState.count = 0
    return json({ count: counterState.count })
})
