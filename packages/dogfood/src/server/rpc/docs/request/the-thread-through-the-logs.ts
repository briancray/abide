import { bag, GET, trace } from 'abide/server'

/**
 * The id that ties this request's log lines to one another and to the caller's.
 *
 * Read from the caller's `traceparent` and minted when there is none, so a line abide writes and a
 * line an app writes name the same operation without either being told about the other. abide never
 * makes a SAMPLING decision of its own — `sampled()` is the caller's, carried through.
 */
export const whatArrived = GET(() => {
    bag().set('startedIn', trace())
    return { operation: trace(), hop: trace.span(), sampled: trace.sampled() }
})
