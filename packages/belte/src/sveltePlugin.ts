import type { BunPlugin } from 'bun'
import { compile, compileModule } from 'svelte/compiler'
import { log } from './log.ts'

export function sveltePlugin(options: { generate: 'server' | 'client' }): BunPlugin {
    return {
        name: 'svelte-loader',
        setup(build) {
            build.onLoad({ filter: /\.svelte\.(js|ts)$/ }, async (args) => {
                const source = await Bun.file(args.path).text()
                const { js, warnings } = compileModule(source, {
                    filename: args.path,
                    generate: options.generate,
                    dev: false,
                })
                for (const w of warnings) {
                    log.warn(`svelte ${args.path}: ${w.message}`)
                }
                return { contents: js.code, loader: 'js' }
            })

            build.onLoad({ filter: /\.svelte$/ }, async (args) => {
                const source = await Bun.file(args.path).text()
                const { js, warnings } = compile(source, {
                    filename: args.path,
                    generate: options.generate,
                    css: 'injected',
                    dev: false,
                })
                for (const w of warnings) {
                    log.warn(`svelte ${args.path}: ${w.message}`)
                }
                return { contents: js.code, loader: 'js' }
            })
        },
    }
}
