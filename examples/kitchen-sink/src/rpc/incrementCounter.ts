import { POST } from 'belte/rpc'
import { json } from 'belte/response'
import { counterState } from '../counterState.ts'

export const incrementCounter = POST<undefined, { count: number }>(() => {
    counterState.count += 1
    return json({ count: counterState.count })
})
