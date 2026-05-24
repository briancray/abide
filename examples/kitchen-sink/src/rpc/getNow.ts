import { handler } from 'belte/rpc/handler'

export const getNow = handler.GET<undefined, { now: string }>(() =>
    Response.json({ now: new Date().toISOString() }),
)
