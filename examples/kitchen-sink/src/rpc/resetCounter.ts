import { handler } from 'belte/rpc/handler'
import { counterState } from '../counterState.ts'

export const resetCounter = handler.DELETE<undefined, { count: number }>(() => {
    counterState.count = 0
    return Response.json({ count: counterState.count })
})
