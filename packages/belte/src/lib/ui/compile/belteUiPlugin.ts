import type { BunPlugin } from 'bun'
import { compileModule } from './compileModule.ts'

/*
Bun plugin that loads `.belte` single-file components: compiles each to the ES
module `compileModule` emits, so they import and mount like any other module.
Registered in the dev/build pipeline alongside the existing svelte loader; the
emitted module's `belte/ui/*` imports resolve through the package exports (the
wiring step that lets examples consume `.belte` files). Mirrors the shape of
sveltePlugin's `.svelte.ts` branch.
*/
// @readme plumbing
export const belteUiPlugin: BunPlugin = {
    name: 'belte-ui',
    setup(build) {
        build.onLoad({ filter: /\.belte$/ }, async (args) => ({
            contents: compileModule(await Bun.file(args.path).text()),
            loader: 'js',
        }))
    },
}
