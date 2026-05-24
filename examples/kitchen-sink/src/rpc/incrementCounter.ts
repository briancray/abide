import { handler } from 'belte/rpc/handler'
import { counterState } from '../counterState.ts'

export const incrementCounter = handler.POST<undefined, { count: number }>(() => {
    counterState.count += 1
    return Response.json({ count: counterState.count })
})
