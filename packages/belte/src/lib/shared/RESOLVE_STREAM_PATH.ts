/*
Path prefix for the out-of-band resolution stream. The SSR document ships a
single-use token in `__SSR__.streamToken`; the browser opens
`${resolveStreamPath}${token}` once to receive its pending {#await} resolutions.
Shared so the server route and the client fetch agree on the path.
*/
export const resolveStreamPath = '/__belte/resolve/'
