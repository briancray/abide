import { DELETE } from '@briancray/belte/server/DELETE'
import { json } from '@briancray/belte/server/json'
import { counterState } from '../../counterState.ts'

export const resetCounter = DELETE(() => {
    counterState.count = 0
    return json({ count: counterState.count })
})
