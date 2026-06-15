/*
The ownership scope currently collecting teardown callbacks. While a component
(or a list row) builds, `scope()` points this at an array; every effect and event
listener created during the build pushes its disposer here, so the whole instance
tears down together. undefined outside any build — effects in plain code own
their own lifecycle via the disposer they return.
*/
export const OWNER: { current: Array<() => void> | undefined } = { current: undefined }
