// The client lane, as one option set — what `abide build` writes to a disk and `abide dev` holds in
// memory are the same bundle, built three decisions apart.
//
// The LANE is the one that matters, and it is one option: `target: 'browser'` is what
// `abide/compiler/plugin` reads to decide that a `server/rpc/**` module elides to its address rather
// than loading its body. So a client entry importing `getUser` gets a `remote("users/getUser")` and
// the database driver behind it never enters the graph — which is a claim about bytes on a wire, so
// `test/build.test.ts` asserts it against the built text rather than trusting the option.
//
// Here rather than in either command for the same reason `entryNames` is in `CLIENT_BUILD.ts`: a
// second copy of what decides what the bundle CONTAINS is `abide dev` serving a different module
// graph than the one `abide build` ships, with nothing saying so. What a command still gets to decide
// is `Lane`, and only that.
//
// The other input is the APP's: the plugins it declared, read from its own bunfig. Same reasoning —
// the two commands must bundle one graph — and it is read here rather than passed in so neither
// command can be the one that forgets to.

import { abidePlugin } from '$compiler/plugin.ts'
import { messageOf } from '$shared/internal/probes.ts'

/** What the two lanes differ about, and the whole of it. */
export interface Lane {
    minify: boolean
    naming: { entry: string; chunk: string; asset: string }
    sourcemap: 'none' | 'linked'
}

/**
 * Where an app names the plugins its client lane is bundled with — Bun's own spelling, read here.
 *
 * `[serve.static] plugins` is what `bun ./index.html` already reads to bundle a page's module graph,
 * and this is the same question asked by a different server: a Tailwind stylesheet an app imports has
 * to be compiled by something, and the framework must not be the thing that knows which something. So
 * there is no fifth convention beside `app.ts` / `app.html` / `pages/` / `client.ts` — the app writes
 * the list once, where a Bun user would already write it.
 */
const BUNFIG = 'bunfig.toml'

/**
 * The plugins the app at `root` declared, in the order it declared them.
 *
 * THROWS on a plugin that is named and cannot be loaded, where the rest of this file answers failure
 * with logs: a stylesheet that quietly did not compile is a build that succeeds and ships a page with
 * no styling, which is the failure that gets discovered by looking at it. A bunfig that is absent, or
 * that names none, is not that — it is an app whose client lane needs nothing but abide's own.
 */
async function appPlugins(root: string): Promise<Bun.BunPlugin[]> {
    // Read rather than probed-then-read: an app without a bunfig is the common case and `exists()` is
    // a second syscall in front of the one that already answers the question. This is serial latency
    // in front of the rebuild a developer is waiting on, once per worker restart.
    let text: string
    try {
        text = await Bun.file(`${root}/${BUNFIG}`).text()
    } catch {
        return []
    }

    let declared: unknown
    try {
        const config = Bun.TOML.parse(text) as {
            serve?: { static?: { plugins?: unknown } }
        }
        declared = config.serve?.static?.plugins
    } catch (failure) {
        throw new Error(`${BUNFIG} did not parse — ${(failure as Error).message}`)
    }
    if (declared === undefined) return []
    if (!Array.isArray(declared)) throw new Error(`${BUNFIG}: \`[serve.static] plugins\` must be a list`)

    const loaded: Bun.BunPlugin[] = []
    for (const specifier of declared) {
        if (typeof specifier !== 'string') {
            throw new Error(`${BUNFIG}: \`[serve.static] plugins\` holds something that is not a name`)
        }
        // Resolved from the app's own root, which is what makes a relative path in a bunfig mean what
        // it reads as and a bare name resolve through the app's dependencies rather than abide's.
        let module: { default?: unknown }
        try {
            module = (await import(Bun.resolveSync(specifier, root))) as { default?: unknown }
        } catch (failure) {
            // `messageOf`, not `.message`: a failed `import()` arrives as `{ errors: [{ message }] }`,
            // and the wrapper's sentence says only that it did not load, not which token was unexpected.
            throw new Error(`the plugin "${specifier}" did not load — ${messageOf(failure)}`)
        }
        const plugin = module.default
        if (typeof plugin !== 'object' || plugin === null || !('setup' in plugin)) {
            throw new Error(`the plugin "${specifier}" has no default export that is a Bun plugin`)
        }
        loaded.push(plugin as Bun.BunPlugin)
    }
    return loaded
}

/**
 * The bundle, or the logs that say why there is none.
 *
 * `throw: false` because the logs are a command's OUTPUT and the exit code is what says it failed,
 * which is the rule `abide check` already follows — and because `abide dev` answers the same failure
 * by serving without a bundle. A throw here would put a stack trace in front of a diagnostic somebody
 * is trying to read. What each command does with `success` is the part they genuinely differ about.
 *
 * The one thing that DOES throw is a declared plugin that could not be loaded — see `appPlugins`.
 */
export async function clientBuild(entrypoints: string[], lane: Lane, root: string): Promise<Bun.BuildOutput> {
    // abide's first, so an app's plugin sees `.abide` the way every other consumer does rather than
    // racing the loader that compiles it.
    const plugins: Bun.BunPlugin[] = [abidePlugin]
    for (const plugin of await appPlugins(root)) plugins.push(plugin)

    return Bun.build({
        entrypoints,
        target: 'browser',
        // The `code-split` half of the row. Every `import()` in a route table is a split point, so a
        // page's module is absent until somebody navigates to it — which is the whole reason a route
        // is reached through a loader rather than an import.
        splitting: true,
        // The operator's environment is not the browser's. Bun will inline `process.env.X` on request,
        // and doing so here publishes `ABIDE_IDENTITY_SECRET` to everybody who loads the page — a
        // client asks `GET /__abide/identity` for what it may know.
        env: 'disable',
        plugins,
        throw: false,
        // What a route's chunk is CALLED, and what it pulls in behind it. A page reached through a
        // loader is a chunk the browser cannot discover until the entry has run far enough to reach
        // the `import()`, and naming it in the head is what stops that being a second serial round
        // trip — see `clientGraph`. Recorded by both lanes because both serve pages.
        metafile: true,
        minify: lane.minify,
        naming: lane.naming,
        sourcemap: lane.sourcemap,
    })
}
