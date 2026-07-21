// `pages/**/<fileName>` → the directory route prefix it maps to. Drops the trailing `fileName`,
// normalises to a leading slash, and collapses the empty (root) case to "/". Shared by the page
// route path (`page.abide`) and the layout route prefix (`layout.abide`).
export function routePrefixFromRelative(relativePath: string, fileName: string): string {
    const dir = relativePath.slice(0, relativePath.length - fileName.length).replace(/\/$/, '')
    return dir.length === 0 ? '/' : `/${dir}`
}
