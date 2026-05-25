import { POST } from 'belte/route'
import { json } from 'belte/respond'
import { counterState } from '../counterState.ts'

export const incrementCounter = POST<undefined, { count: number }>(() => {
    counterState.count += 1
    return json({ count: counterState.count })
})
