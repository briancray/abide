/*
Path prefix for the out-of-band resolution stream. The SSR document ships a
single-use token in `__SSR__.streamToken`; the browser opens
`${RESOLVE_STREAM_PATH}${token}` once to receive its pending {#await} resolutions.
Shared so the server route and the client fetch agree on the path.
*/
export const RESOLVE_STREAM_PATH = '/__abide/resolve/'
