import { json } from '@briancray/belte/server/json'
import { POST } from '@briancray/belte/server/POST'
import { counterState } from '../../counterState.ts'

export const incrementCounter = POST(() => {
    counterState.count += 1
    return json({ count: counterState.count })
})
