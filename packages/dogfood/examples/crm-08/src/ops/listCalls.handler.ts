import { GET } from '@abide/abide/server'

import { calls } from './lib/calls.ts'

/** Answers at /ops/listCalls; every tab reading it follows it. */
export default GET(calls, {
    description: 'The calls logged against a contact.',
})
