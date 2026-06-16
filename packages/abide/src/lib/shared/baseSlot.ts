/*
Internal slot the runtime entries register their mount-base resolver into.
The server entry installs an APP_URL-derived resolver at boot; the client
entry installs one reading window.__SSR__.base. `fallback` is a single value
used only when no resolver is registered — lets isolated tests set a base
without spinning up the runtime. Mirrors pageSlot / cacheStoreSlot.
*/
export const baseSlot: {
    resolver: (() => string) | undefined
    fallback: string | undefined
} = {
    resolver: undefined,
    fallback: undefined,
}
