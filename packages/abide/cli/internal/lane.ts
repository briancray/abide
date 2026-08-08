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

import { abidePlugin } from '$compiler/plugin.ts'

/** What the two lanes differ about, and the whole of it. */
export interface Lane {
    minify: boolean
    naming: { entry: string; chunk: string; asset: string }
    sourcemap: 'none' | 'linked'
}

/**
 * The bundle, or the logs that say why there is none.
 *
 * `throw: false` because the logs are a command's OUTPUT and the exit code is what says it failed,
 * which is the rule `abide check` already follows — and because `abide dev` answers the same failure
 * by serving without a bundle. A throw here would put a stack trace in front of a diagnostic somebody
 * is trying to read. What each command does with `success` is the part they genuinely differ about.
 */
export function clientBuild(entrypoints: string[], lane: Lane): Promise<Bun.BuildOutput> {
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
        plugins: [abidePlugin],
        throw: false,
        minify: lane.minify,
        naming: lane.naming,
        sourcemap: lane.sourcemap,
    })
}
