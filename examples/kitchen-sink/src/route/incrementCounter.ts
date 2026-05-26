import { json } from 'belte/respond'
import { POST } from 'belte/route'
import { counterState } from '../counterState.ts'

export const incrementCounter = POST(() => {
    counterState.count += 1
    return json({ count: counterState.count })
})
