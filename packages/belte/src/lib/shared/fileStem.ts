/*
The bare filename of a path, with directory and trailing extension stripped —
e.g. `users/list.ts` → `list`, `/_virtual/mcp-resources.ts` → `mcp-resources`.
Used to derive a virtual-module name from its path and to check an $rpc /
$sockets module's single export name against its file stem.
*/
export function fileStem(path: string): string {
    return (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
}
