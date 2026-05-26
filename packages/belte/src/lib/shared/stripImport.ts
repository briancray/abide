/*
Strips the user's `import { … } from '<moduleName>'` line from a module
source. Used by the $rpc / $sockets rewriters to remove the verb /
`socket` import after it's been replaced by the runtime-injected binding.
*/
export function stripImport(source: string, moduleName: string): string {
    const escaped = moduleName.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
    const pattern = new RegExp(
        `^\\s*import\\s*\\{[^}]*\\}\\s*from\\s*['"]${escaped}['"]\\s*;?\\s*$`,
        'gm',
    )
    return source.replace(pattern, '')
}
