import type { BunPlugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import type { SvelteConfig } from './lib/shared/types/SvelteConfig.ts'
import { sveltePlugin } from './sveltePlugin.ts'

/*
The server-target Bun.build plugin pair shared by compile / buildCli /
bundleApp: the svelte loader (server generate) plus belte's virtual-module
resolver. `embedAssets` flips on the zstd asset embed used by the standalone
server binary; the CLI + launcher builds leave it off.
*/
export function serverBuildPlugins({
    cwd,
    svelteConfig,
    embedAssets = false,
}: {
    cwd: string
    svelteConfig?: SvelteConfig
    embedAssets?: boolean
}): BunPlugin[] {
    return [
        sveltePlugin({ generate: 'server', svelteConfig }),
        belteResolverPlugin({ cwd, embedAssets, target: 'server' }),
    ]
}
