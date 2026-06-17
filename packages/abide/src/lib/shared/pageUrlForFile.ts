/*
Maps a page-relative path (under `src/ui/pages/`) to its URL route. Pages are
folder-based: every leaf is `page.abide` or `layout.abide`, and the URL
is the directory path. Pages mount at the directory path; layouts mount at
the directory prefix. Dynamic segments keep their `[name]` / `[...rest]`
shape — translation to Bun's `:name` / `*` happens at server registration
via toBunRoutePattern; consumers see the readable form in `nav.route`.
*/
export function pageUrlForFile(relPath: string): string {
    const segments = relPath.split('/')
    segments.pop()
    const path = segments.filter(Boolean).join('/')
    return path === '' ? '/' : `/${path}`
}
