/*
Path of the identity probe answering `{ abide, name, version }` ahead of any
app middleware. Shared so the server mount (createServer) and the launcher's
probe (probeAbideServer) agree on the path.
*/
export const IDENTITY_PATH = '/__abide/identity'
