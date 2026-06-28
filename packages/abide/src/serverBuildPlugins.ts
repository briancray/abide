import type { BunPlugin } from 'bun'
import { abideResolverPlugin } from './abideResolverPlugin.ts'
import { abideUiPlugin } from './lib/ui/compile/abideUiPlugin.ts'
import { zodCjsPlugin } from './zodCjsPlugin.ts'

/*
The server-target Bun.build plugin set shared by compile / buildCli / bundleApp:
the abide-ui `.abide` loader (so SSR `render()` resolves), abide's virtual-module
resolver, and the zod→CommonJS shim that works around bun's broken ESM-cycle
bundling (see zodCjsPlugin). `embedAssets` flips on the gzip asset embed used by
the standalone server binary; the CLI + launcher builds leave it off.
*/
export function serverBuildPlugins({
    cwd,
    embedAssets = false,
}: {
    cwd: string
    embedAssets?: boolean
}): BunPlugin[] {
    return [
        zodCjsPlugin(cwd),
        abideUiPlugin,
        abideResolverPlugin({ cwd, embedAssets, target: 'server' }),
    ]
}
