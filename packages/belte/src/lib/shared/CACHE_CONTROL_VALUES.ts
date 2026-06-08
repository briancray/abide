/*
Cache-Control values used by belte's framework responses. Centralised so
the framework's policy (no-store on errors and rpc dispatch helpers,
private/no-cache on SSR HTML, the static-asset policies) lives in one place
and can't drift between the server core, the asset servers, and the respond
helpers.
*/
export const NO_STORE = 'no-store'
export const SSR_CACHE_CONTROL = 'private, no-cache'

// Content-addressed `/_app/` chunks (name carries the hash) — cache forever.
export const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
// Unhashed `/_app/` entries (entry bundle, shell) — must revalidate each time.
export const REVALIDATE_ASSET_CACHE_CONTROL = 'public, max-age=0, must-revalidate'
// Files served from public/ at the site root — short shared cache.
export const PUBLIC_ASSET_CACHE_CONTROL = 'public, max-age=3600'
