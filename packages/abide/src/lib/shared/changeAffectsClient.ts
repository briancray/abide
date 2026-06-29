/*
Classifies a watcher change (a path relative to the project's `src/`, with
either OS separator) by whether it can alter the client bundle. The dev
orchestrator uses this to skip the full client `Bun.build` for changes that
only reach the server or MCP runtimes, while still restarting the SSR worker.

Server/MCP-only — client unaffected, skip the client rebuild:
- `server/rpc/**`     — the client only ships proxy stubs derived from the file
                        path (rpc url) and the `<METHOD>(...)` wrapper, not the
                        handler body; the rpc manifest is server-only. A body
                        edit produces an identical stub. (Risk: changing the
                        method, the export name, or `outbox: true` does change
                        the stub — those need a manual full rebuild.)
- `server/sockets/**` — name-only `socketProxy` stubs derived from the file
                        path; socket opts are server-side. Body edits don't
                        change the stub.
- `mcp/**`            — prompts/resources are MCP-only; the client bundle never
                        imports them (it emits empty stubs defensively).
- `server/config.ts`  — server boot-time env validation (`abide:config`); never
                        reaches the client.

Everything else (`.abide` templates, `ui/**`, `shared/**`, `app.ts`, state
files, the rest of `server/`) is treated as client-affecting. Conservative by
default: an unrecognised path returns true so an ambiguous change still pays the
full rebuild rather than risking a stale client.
*/
export function changeAffectsClient(relativePath: string): boolean {
    const path = relativePath.split('\\').join('/')
    const serverOnly =
        path.startsWith('server/rpc/') ||
        path.startsWith('server/sockets/') ||
        path.startsWith('mcp/') ||
        path === 'server/config.ts'
    return !serverOnly
}
