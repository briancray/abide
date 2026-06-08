import { json } from '@belte/belte/server/json'
import { POST } from '@belte/belte/server/POST'
import { counterState } from '../../counterState.ts'

export const incrementCounter = POST(() => {
    counterState.count += 1
    return json({ count: counterState.count })
})
