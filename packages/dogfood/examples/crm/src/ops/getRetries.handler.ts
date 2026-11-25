import { config, GET, onConfig } from '@abide/abide/server'

// The default; a deployment's RETRIES overrides it.
onConfig(() => ({ RETRIES: 3 }))

/** Answers at /ops/getRetries: the retry count, and nothing else in config. */
export default GET(() => ({ retries: config().RETRIES }), {
    description: 'How many times a failed call is retried.',
})
