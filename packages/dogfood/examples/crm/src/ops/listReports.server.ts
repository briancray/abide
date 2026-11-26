import { onReport, principal, rpc } from '@abide/abide/server'

// Kept per browser, as the page is public; an app posts each to its tracker.
const received = new Map<string, string[]>()

onReport((report) => {
    const caller = principal.caller()
    received.set(caller, [...(received.get(caller) ?? []), report.summary])
})

/** Answers at /ops/listReports: the summaries this browser has sent. */
export default rpc(() => received.get(principal.caller()) ?? [], {
    description: 'Lists the problem reports this browser sent.',
})
