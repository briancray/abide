import { plugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import { sveltePlugin } from './sveltePlugin.ts'

const mode = (process.env.BELTE_SVELTE_MODE ?? 'server') as 'server' | 'client'

plugin(sveltePlugin({ generate: mode }))
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
