import { config, onConfig, rpc } from '@abide/abide/server'

// The default; a deployment's RETRIES overrides it.
onConfig(() => ({ RETRIES: 3 }))

/** Answers at /ops/getRetries: the retry count, and nothing else in config. */
export default rpc(() => ({ retries: config.get().RETRIES }), {
    description: 'How many times a failed call is retried.',
})
