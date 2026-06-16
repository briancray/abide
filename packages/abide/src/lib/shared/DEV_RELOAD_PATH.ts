/*
Path of the dev-only live-reload SSE channel. Shared so the server mount
(createServer) and the client script injected into dev pages
(DEV_RELOAD_CLIENT_SCRIPT) agree on the path.
*/
export const DEV_RELOAD_PATH = '/__abide/dev'
