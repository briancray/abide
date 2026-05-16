import { plugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import { loadSvelteConfig } from './lib/shared/loadSvelteConfig.ts'
import { sveltePlugin } from './sveltePlugin.ts'

const mode = (process.env.BELTE_SVELTE_MODE ?? 'server') as 'server' | 'client'
const svelteConfig = await loadSvelteConfig()

plugin(sveltePlugin({ generate: mode, svelteConfig }))
plugin(belteResolverPlugin())

plugin({
    name: 'css-noop',
    setup(build) {
        build.onLoad({ filter: /\.css$/ }, () => ({
            contents: 'export default {};',
            loader: 'js',
        }))
    },
})
