/*
Derives the CLI program/binary name from a package.json `name` field.
Scoped names (`@scope/tool`) keep only the final segment so the value is
safe as a filesystem path, tar entry name, and CLI display name — a raw
`/` would otherwise nest the binary into an unexpected directory and break
the `/__belte/cli/<platform>` download route's path lookup. Falls back to
`app` when the name is absent or empty.
*/
export function programNameForPackage(name: string | undefined): string {
    if (name === undefined || name === '') {
        return 'app'
    }
    return name.split('/').pop() || 'app'
}
