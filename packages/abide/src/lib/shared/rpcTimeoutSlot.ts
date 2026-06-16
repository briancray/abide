/*
Slot the client entry registers the env-configured RPC fetch timeout (ms)
into. The server reads ABIDE_CLIENT_TIMEOUT at boot and ships it via
__SSR__.clientTimeout, so the value reflects the running server's env rather
than build time; startClient installs it here and remoteProxy reads it.
undefined = no timeout (the default — RPC fetches stay unbounded as before).
Mirrors baseSlot.
*/
export const rpcTimeoutSlot: { ms: number | undefined } = { ms: undefined }
