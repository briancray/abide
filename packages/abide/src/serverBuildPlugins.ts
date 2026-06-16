import type { BunPlugin } from 'bun'
import { abideResolverPlugin } from './abideResolverPlugin.ts'
import { abideUiPlugin } from './lib/ui/compile/abideUiPlugin.ts'

/*
The server-target Bun.build plugin pair shared by compile / buildCli / bundleApp:
the abide-ui `.abide` loader (so SSR `render()` resolves) plus abide's virtual-
module resolver. `embedAssets` flips on the zstd asset embed used by the
standalone server binary; the CLI + launcher builds leave it off.
*/
export function serverBuildPlugins({
    cwd,
    embedAssets = false,
}: {
    cwd: string
    embedAssets?: boolean
}): BunPlugin[] {
    return [abideUiPlugin, abideResolverPlugin({ cwd, embedAssets, target: 'server' })]
}
