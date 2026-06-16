import { baseSlot } from './baseSlot.ts'

/*
The current mount base path ('' at root). Resolved per side: the server
installs an APP_URL-derived resolver at boot, the client one reading
window.__SSR__.base. url() reads this to prefix rooted internal paths.
*/
export function basePath(): string {
    return baseSlot.resolver?.() ?? baseSlot.fallback ?? ''
}
