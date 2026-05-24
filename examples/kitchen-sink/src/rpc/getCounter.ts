import { handler } from 'belte/rpc/handler'
import { counterState } from '../counterState.ts'

export const getCounter = handler.GET<undefined, { count: number }>(() =>
    Response.json({ count: counterState.count }),
)
