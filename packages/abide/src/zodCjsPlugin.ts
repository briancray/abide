import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BunPlugin } from 'bun'

/*
Routes every `zod` import in a server bundle to zod's CommonJS build.

zod v4's ESM is reached through two subpaths (`zod` and `zod/v4/core`) whose
modules form an initialization cycle. Bun's bundler emits a broken init order
for that cycle (oven-sh/bun#31586, closed as not-planned), so a bundled binary
crashes (`<helper> is not defined`) or — for a lazily imported module — silently
fails to evaluate, which drops every rpc whose module imports zod from the
registry. It only bites bundled output; `abide dev` runs unbundled and is fine.

zod ships a parallel CommonJS build (`index.cjs`, `v4/core/index.cjs`, …), and
CommonJS resolves circular requires through a mutating `module.exports` with no
temporal-dead-zone, so the cycle initializes correctly. Resolving each zod
specifier to its `.cjs` sibling makes bun bundle zod as CommonJS and sidesteps
the bug while keeping zod v4. Server-only: the client bundle strips zod from rpc
modules (they become remote proxies), and dev never bundles.
*/
export function zodCjsPlugin(cwd: string): BunPlugin {
    return {
        name: 'abide-zod-cjs',
        setup(build) {
            build.onResolve({ filter: /^zod($|\/)/ }, (args) => {
                /* Resolve from the importer (or cwd for the entry) to zod's ESM
                   target, then swap to its `.cjs` sibling when one exists. */
                const from = args.importer ? dirname(args.importer) : cwd
                const resolved = Bun.resolveSync(args.path, from)
                const cjs = resolved.replace(/\.js$/, '.cjs')
                return { path: existsSync(cjs) ? cjs : resolved }
            })
        },
    }
}
