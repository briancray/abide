import { baseResolver } from './baseResolver.ts'

/*
The current mount base path ('' at root). Resolved per side: the server installs
an APP_URL-derived resolver at boot, the client one reading window.__SSR__.base.
url() reads this to prefix rooted internal paths. Defaults to '' when no resolver
or fallback is set.
*/
export function basePath(): string {
    return baseResolver.get() ?? ''
}
