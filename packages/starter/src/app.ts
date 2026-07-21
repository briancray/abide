// Process-lifecycle hooks + the request/nav middleware onion (CL3). Auth is just middleware:
// a guard is a middleware that returns error(403) instead of calling next().
export const middleware = []

export function onStart(): void {}
export function onStop(): void {}
