import { json } from 'belte/server'
import { POST } from 'belte/server'
import { counterState } from '../../counterState.ts'

export const incrementCounter = POST(() => {
    counterState.count += 1
    return json({ count: counterState.count })
})
