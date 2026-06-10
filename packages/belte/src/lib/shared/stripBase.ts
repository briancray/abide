import { basePath } from './basePath.ts'

/*
Strips the mount base from a browser-space pathname (`/v2/people` → `/people`)
so it can be matched against app-space route tables — the read-side inverse of
withBase: belte adds the base exactly once on the way out (url()/withBase) and
strips it on the way in. A pathname outside the base — including a false
prefix like `/v2x` — returns untouched; the bare base itself resolves to `/`.
*/
export function stripBase(pathname: string): string {
    const base = basePath()
    if (!base || !pathname.startsWith(base)) {
        return pathname
    }
    const rest = pathname.slice(base.length)
    if (rest === '') {
        return '/'
    }
    return rest.startsWith('/') ? rest : pathname
}
