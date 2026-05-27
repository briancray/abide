/*
Derives the MCP tool name / CLI subcommand name from an rpc URL. Strips
the framework's `/rpc/` mount and joins nested folder segments with `-`
so `users/list.ts` (mounted at `/rpc/users/list`) becomes `users-list`
across both surfaces. Folder prefixing prevents collisions when two
files in different folders share the same stem (e.g. `users/list.ts`
and `posts/list.ts`); `/` is not a valid character in MCP tool names or
typical CLI subcommands, so the join uses `-`.
*/
const RPC_PREFIX = '/rpc/'

export function commandNameForUrl(url: string): string {
    const trimmed = url.startsWith(RPC_PREFIX)
        ? url.slice(RPC_PREFIX.length)
        : url.replace(/^\//, '')
    return trimmed.replaceAll('/', '-')
}
