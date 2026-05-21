import type { BunPlugin } from 'bun'
import { compile, compileModule } from 'svelte/compiler'
import { log } from './lib/shared/log.ts'
import type { SvelteConfig } from './lib/types/SvelteConfig.ts'

/*
Bun plugin that compiles `.svelte` components (with CSS injected at runtime)
and `.svelte.{js,ts}` rune modules via the svelte compiler. `.svelte.ts`
modules are first transpiled by Bun.Transpiler so the svelte compiler only
sees stripped JS. `generate` chooses 'server' (SSR) or 'client' (hydration);
the build pipeline constructs a separate plugin instance per target.
*/
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
                for (const warning of warnings) {
                    log.warn(`svelte ${args.path}: ${warning.message}`)
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
                for (const warning of warnings) {
                    log.warn(`svelte ${args.path}: ${warning.message}`)
                }
                return { contents: js.code, loader: 'js' }
            })
        },
    }
}
