import { compile, compileModule } from 'svelte/compiler'

/*
Test preload registering a `.svelte.ts` loader so rune modules under
tests/support compile through the Svelte compiler — the only way to write
$state/$effect/$effect.root in a test harness that drives belte's
createSubscriber-based consumers (tail/cache reactivity). Mirrors the
`.svelte.ts` branch of sveltePlugin. A `.svelte` component branch compiles
SSR-side (generate: 'server') so the HTTP harness can boot createServer —
which imports App.svelte and renders fixture pages — in-process; tailwind
preprocessing is skipped since fixtures carry no styles.
*/
const transpiler = new Bun.Transpiler({ loader: 'ts' })

/*
`svelte/reactivity` resolves to its server build under Bun (no `browser`
export condition), where createSubscriber is a no-op — so tail()/cache()
reactivity is dead in tests. Bun's runtime loader honours onLoad but not
onResolve, so swap the loaded server build for the client build by content
(a relative re-export, since both sit in the same directory). Pair with a
`globalThis.window` in the test itself.
*/
Bun.plugin({
    name: 'svelte-reactivity-client',
    setup(build) {
        build.onLoad({ filter: /reactivity[/\\]index-server\.js$/ }, () => ({
            contents: "export * from './index-client.js'",
            loader: 'js',
        }))
    },
})

Bun.plugin({
    name: 'svelte-module-test-loader',
    setup(build) {
        build.onLoad({ filter: /\.svelte\.ts$/ }, async (args) => {
            const raw = await Bun.file(args.path).text()
            const { js } = compileModule(transpiler.transformSync(raw), {
                filename: args.path,
                generate: 'client',
                dev: false,
            })
            return { contents: js.code, loader: 'js' }
        })

        /*
        SSR component compile for the HTTP harness's fixture pages/layouts and
        belte's own App.svelte. `experimental.async` matches the scaffold's
        svelte.config.js, so fixtures can `await` a cache read at component top
        level — the form that drives the inline-vs-streamed SSR partition.
        */
        build.onLoad({ filter: /\.svelte$/ }, async (args) => {
            const raw = await Bun.file(args.path).text()
            const { js } = compile(raw, {
                filename: args.path,
                generate: 'server',
                css: 'injected',
                dev: false,
                experimental: { async: true },
            })
            return { contents: js.code, loader: 'js' }
        })
    },
})
