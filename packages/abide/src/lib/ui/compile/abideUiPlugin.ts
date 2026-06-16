import type { BunPlugin } from 'bun'
import { compileModule } from './compileModule.ts'

/*
Bun plugin that loads `.abide` single-file components: compiles each to the ES
module `compileModule` emits, so they import and mount like any other module. The
only UI loader in the dev/build/preload pipeline; the emitted module's
`abide/ui/*` imports resolve through the package exports.

A `layout.abide` compiles as a layout: its `<slot/>` lowers to the router's page
outlet (`<abide-outlet>`) rather than a passed-children slot — the file's role is
its name, so the loader flags it from the path stem.
*/
// @readme plumbing
export const abideUiPlugin: BunPlugin = {
    name: 'abide-ui',
    setup(build) {
        build.onLoad({ filter: /\.abide$/ }, async (args) => ({
            contents: compileModule(await Bun.file(args.path).text(), {
                isLayout: (args.path.split('/').pop() ?? '') === 'layout.abide',
            }),
            loader: 'js',
        }))
    },
}
