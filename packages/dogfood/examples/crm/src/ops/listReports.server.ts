import { principal } from '@abide/abide'
import { onReport, rpc } from '@abide/abide/server'

// Kept per browser, as the page is public; an app posts each to its tracker.
const received = new Map<string, string[]>()

onReport((report) => {
    const caller = principal.caller.get()
    received.set(caller, [...(received.get(caller) ?? []), report.summary])
})

/** Answers at /ops/listReports: the summaries this browser has sent. */
export const listReports = rpc(() => received.get(principal.caller.get()) ?? [], {
    description: 'Lists the problem reports this browser sent.',
})
