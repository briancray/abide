/*
Cache-Control values used by belte's framework responses. Centralised so
the framework's policy (no-store on errors and rpc dispatch helpers,
private/no-cache on SSR HTML) lives in one place and can't drift between
the server core and the respond helpers.
*/
export const NO_STORE = 'no-store'
export const SSR_CACHE_CONTROL = 'private, no-cache'
