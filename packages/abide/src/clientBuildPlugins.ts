import type { BunPlugin } from 'bun'
import { abideResolverPlugin } from './abideResolverPlugin.ts'
import { abideLog } from './lib/shared/abideLog.ts'
import { isModuleNotFound } from './lib/shared/isModuleNotFound.ts'
import { abideUiPlugin } from './lib/ui/compile/abideUiPlugin.ts'

/*
The client-target Bun.build plugin chain shared by the page bundle (build) and
the bundle connect screen (buildDisconnected): the abide-ui `.abide` loader,
abide's virtual-module resolver, and the optional Tailwind plugin. Tailwind is an
optional peer — a genuine "not installed" builds without it, but any other load
error surfaces (a plugin that loaded then threw on a real misconfig must not
silently ship unstyled). `tailwindWarning` names what each caller builds without
when Tailwind is absent.
*/
export async function clientBuildPlugins({
    cwd,
    tailwindWarning,
}: {
    cwd: string
    tailwindWarning: string
}): Promise<BunPlugin[]> {
    const plugins: BunPlugin[] = [abideUiPlugin, abideResolverPlugin({ cwd, target: 'client' })]
    try {
        plugins.push((await import('bun-plugin-tailwind')).default)
    } catch (error) {
        if (!isModuleNotFound(error)) {
            throw error
        }
        abideLog.warn(tailwindWarning)
    }
    return plugins
}
