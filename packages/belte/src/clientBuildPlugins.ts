import type { BunPlugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import { dedupeSveltePlugin } from './dedupeSveltePlugin.ts'
import { belteLog } from './lib/shared/belteLog.ts'
import { isModuleNotFound } from './lib/shared/isModuleNotFound.ts'
import type { SvelteConfig } from './lib/shared/types/SvelteConfig.ts'
import { sveltePlugin } from './sveltePlugin.ts'

/*
The client-target Bun.build plugin chain shared by the page bundle (build)
and the bundle connect screen (buildDisconnected): svelte-dedupe, the svelte
client loader, belte's virtual-module resolver, and the optional Tailwind
plugin. Tailwind is an optional peer — a genuine "not installed" builds
without it, but any other load error surfaces (a plugin that loaded then
threw on a real misconfig must not silently ship unstyled). `tailwindWarning`
names what each caller builds without when Tailwind is absent.
*/
export async function clientBuildPlugins({
    cwd,
    svelteConfig,
    tailwindWarning,
}: {
    cwd: string
    svelteConfig?: SvelteConfig
    tailwindWarning: string
}): Promise<BunPlugin[]> {
    const plugins: BunPlugin[] = [
        dedupeSveltePlugin({ cwd, conditions: ['browser', 'default'] }),
        sveltePlugin({ generate: 'client', svelteConfig }),
        belteResolverPlugin({ cwd, target: 'client' }),
    ]
    try {
        plugins.push((await import('bun-plugin-tailwind')).default)
    } catch (error) {
        if (!isModuleNotFound(error)) {
            throw error
        }
        belteLog.warn(tailwindWarning)
    }
    return plugins
}
