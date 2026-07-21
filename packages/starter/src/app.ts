// Process-lifecycle hooks + the request/nav middleware onion (CL3). Auth is just middleware:
// a guard is a middleware that returns error(403) instead of calling next().
export const middleware = []

// onStart/onStop WRAP the real boot/teardown: run setup, then `await start()` to bind the server
// (returning without it aborts boot); `await stop()` tears it down. onError shapes the reply for an
// unexpected throw during a request.
export async function onStart(start: () => Promise<void>): Promise<void> {
    await start()
}

export async function onStop(stop: () => Promise<void>): Promise<void> {
    await stop()
}
