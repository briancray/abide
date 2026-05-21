import { requireStore } from './requireStore.ts'

/*
Appends a Set-Cookie header value to the final Response. Multiple cookies
are preserved as separate Set-Cookie entries rather than collapsed.
*/
export function setCookie(cookie: string): void {
    requireStore('setCookie').response.cookies.push(cookie)
}
