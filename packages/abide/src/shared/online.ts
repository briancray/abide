// Whether the caller currently has connectivity.
//
// REACTIVE, for the same reason `route()` is: connectivity changes without a new caller arriving, so
// a probe that only answered on the next ask would leave a banner up after the network came back —
// and take one down that nobody had noticed go up. It is a `state` cell behind a call, which is the
// spelling every other source already has.
//
// A server is always online in the only sense this question has. It is not asking whether the process
// can reach the internet; it is asking whether the caller can reach the thing it is talking to, and
// a server IS that thing. Answering `navigator.onLine`'s question there would be answering a
// different one, quietly.

import { state } from './reactive.ts'

/**
 * The browser's own answer, which is a LOWER bound and says so: false means there is provably no
 * route out, true means there is a local link and nothing more. That is still the only signal
 * available without inventing a heartbeat, and a heartbeat is an app's decision rather than a
 * framework's.
 */
const NAVIGATOR = globalThis as { navigator?: { onLine?: boolean } }

const connected = state(NAVIGATOR.navigator?.onLine ?? true)

// Listeners rather than a poll, and attached once at import rather than per reader: the events are
// what the platform already fires, and a cell with no readers costs nothing to keep current.
if (typeof addEventListener === 'function' && NAVIGATOR.navigator?.onLine !== undefined) {
    addEventListener('online', () => connected.set(true))
    addEventListener('offline', () => connected.set(false))
}

/** Whether the caller currently has connectivity. Subscribes the reader, like every other source. */
export function online(): boolean {
    return connected()
}
