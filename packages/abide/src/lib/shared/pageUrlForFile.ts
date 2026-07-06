/*
Maps a page-relative path (under `src/ui/pages/`) to its URL route. Pages are
folder-based: every leaf is `page.abide` or `layout.abide`, and the URL
is the directory path. Pages mount at the directory path; layouts mount at
the directory prefix. Dynamic segments keep their `[name]` / `[[name]]` / `[...rest]`
shape — the shared matchRoute resolves them at dispatch on both sides;
consumers see the readable form in `page.route`.
*/
export function pageUrlForFile(relPath: string): string {
    const segments = relPath.split('/')
    segments.pop()
    const path = segments.filter(Boolean).join('/')
    return path === '' ? '/' : `/${path}`
}
