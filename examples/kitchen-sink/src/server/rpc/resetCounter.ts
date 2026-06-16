import { DELETE } from '@abide/abide/server/DELETE'
import { json } from '@abide/abide/server/json'
import { counterState } from '../../counterState.ts'

export const resetCounter = DELETE(() => {
    counterState.count = 0
    return json({ count: counterState.count })
})
