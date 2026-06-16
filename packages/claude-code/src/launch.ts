import { appMcpServers } from './appMcpServers.ts'
import { claudeCliArgs } from './claudeCliArgs.ts'
import type { PermissionMode } from './PermissionMode.ts'

/*
Launches the interactive `claude` TUI wired to a abide app's MCP surface. Unlike
the engine (headless query()), this spawns the real binary — so it touches no SDK
— and maps the same MCP contract to CLI flags: `--mcp-config` for the app server,
`--strict-mcp-config` + `--setting-sources ''` to isolate from the host's ambient
servers and settings, `--permission-mode` for the session policy.

Inherits stdio (it's a TUI) and forwards Ctrl+C so the child tears down cleanly,
then mirrors its exit code — `never` because the process is replaced.
*/
type LaunchConfig = {
    // The abide app whose MCP the TUI drives (local dev server or a deployed origin).
    url: string
    mcpToken?: string
    permissionMode?: PermissionMode
}

export async function launch(config: LaunchConfig): Promise<never> {
    const servers = await appMcpServers(config.url, config.mcpToken)
    const args = [
        'claude',
        ...claudeCliArgs({
            servers,
            permissions: config.permissionMode ? { defaultMode: config.permissionMode } : undefined,
            headless: false,
        }),
    ]
    const child = Bun.spawn({ cmd: args, stdio: ['inherit', 'inherit', 'inherit'] })
    const forward = (signal: NodeJS.Signals) => {
        child.kill(signal)
        setTimeout(() => child.kill('SIGKILL'), 3000).unref()
    }
    process.on('SIGINT', () => forward('SIGINT'))
    process.on('SIGTERM', () => forward('SIGTERM'))
    process.exit(await child.exited)
}
