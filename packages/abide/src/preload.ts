// @readme plumbing
import { plugin } from 'bun'
import { abideResolverPlugin } from './abideResolverPlugin.ts'
import { abideUiPlugin } from './lib/ui/compile/abideUiPlugin.ts'

const mode = (process.env.ABIDE_TARGET ?? 'server') as 'server' | 'client'

await plugin(abideUiPlugin)
await plugin(abideResolverPlugin({ target: mode }))

await plugin({
    name: 'css-noop',
    setup(build) {
        build.onLoad({ filter: /\.css$/ }, () => ({
            contents: 'export default {};',
            loader: 'js',
        }))
    },
})
