/*
Path prefix of the dev-only component hot-module endpoint (`/__abide/hot/<moduleId>`).
The browser imports `<prefix><moduleId>?v=<hash>` to fetch one edited component's
hot module instead of reloading. Shared so the server route (createServer) and the
live-reload client (DEV_RELOAD_CLIENT_SCRIPT) agree.
*/
export const DEV_HOT_PREFIX = '/__abide/hot/'
