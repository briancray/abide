import { handler } from 'belte/rpc/handler'

export const boom = handler.GET<undefined, never>(() => {
    throw new Error('intentional boom — demonstrating the 500 error path')
})
