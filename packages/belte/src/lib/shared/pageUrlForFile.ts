import { toRoutePattern } from './toRoutePattern.ts'

/*
Maps a page-relative path (under `src/pages/`) to its URL route. Pages are
folder-based: every leaf is `page.svelte` or `layout.svelte`, and the URL
is the directory path. Pages mount at the directory path; layouts mount at
the directory prefix. `[name]` folder segments become `:name`, `[...rest]`
becomes `*` (Bun's catch-all wildcard).
*/
export function pageUrlForFile(relPath: string): string {
    const segments = relPath.split('/')
    segments.pop()
    const path = segments.filter(Boolean).map(toRoutePattern).join('/')
    return path === '' ? '/' : `/${path}`
}
