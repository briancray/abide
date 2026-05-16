import type { BunPlugin } from 'bun'
import { compile, compileModule } from 'svelte/compiler'
import { log } from './lib/shared/log.ts'
import type { SvelteConfig } from './lib/types/SvelteConfig.ts'

export function sveltePlugin(options: {
    generate: 'server' | 'client'
    svelteConfig?: SvelteConfig
}): BunPlugin {
    return {
        name: 'svelte-loader',
        setup(build) {
            const userOptions = options.svelteConfig?.compilerOptions ?? {}
            const tsTranspiler = new Bun.Transpiler({ loader: 'ts' })
            build.onLoad({ filter: /\.svelte\.(js|ts)$/ }, async (args) => {
                const raw = await Bun.file(args.path).text()
                const source = args.path.endsWith('.ts') ? tsTranspiler.transformSync(raw) : raw
                const { js, warnings } = compileModule(source, {
                    ...userOptions,
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
                    ...userOptions,
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
