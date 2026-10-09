import { config, GET } from 'abide/server'

export const retryPolicy = GET(() => ({ retries: config().RETRIES }), {
    description: 'How many times a call is retried.',
})
