import { join, sep } from 'node:path'

// Framework path aliases usable from any `.abide` import specifier (a `.abide` component, a `.css`,
// a `.ts`) — the same aliases abide scaffolds into an app tsconfig: `$server` → `src/server`,
// `$ui` → `src/ui`, `$shared` → `src/shared`. Resolved against the importer's OWN directory by
// walking up to its nearest `src/` ancestor, so an alias works no matter how deep the file sits
// (unlike a `../../..` relative path). Returns an absolute path, or `undefined` when `specifier`
// isn't one of the aliases (the caller then falls back to relative resolution).
//
// RPC imports (`$server/rpc/<name>`) need no path here — they're recognised textually by the
// `server/rpc/` segment and keyed by basename (see emitServer.ts), so the alias flows through for free.
const ALIAS_SUBDIR: Record<string, string> = { $server: 'server', $ui: 'ui', $shared: 'shared' }

export function resolveTemplateAlias(specifier: string, fromDir: string): string | undefined {
    const slash = specifier.indexOf('/')
    if (slash === -1) return undefined
    const subdir = ALIAS_SUBDIR[specifier.slice(0, slash)]
    if (subdir === undefined) return undefined
    const segments = fromDir.split(sep)
    const srcIndex = segments.lastIndexOf('src')
    if (srcIndex === -1) return undefined
    const srcRoot = segments.slice(0, srcIndex + 1).join(sep)
    return join(srcRoot, subdir, specifier.slice(slash + 1))
}
