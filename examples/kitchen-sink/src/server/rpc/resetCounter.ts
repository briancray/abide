import { json } from 'belte/server'
import { DELETE } from 'belte/server'
import { counterState } from '../../counterState.ts'

export const resetCounter = DELETE(() => {
    counterState.count = 0
    return json({ count: counterState.count })
})
