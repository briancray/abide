import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'
import { counterState } from '../../counterState.ts'

export const incrementCounter = POST(() => {
    counterState.count += 1
    return json({ count: counterState.count })
})
