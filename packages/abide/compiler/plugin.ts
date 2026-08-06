// `.abide` becomes an importable module.
//
// Registered through `bunfig.toml` `preload` for the runtime lanes (`bun test`, `bun run example`)
// and through `[serve.static] plugins` for the browser bundle, so the SAME compiler output runs in
// every lane — there is no build step whose result could differ from what the tests loaded.

import { dirname, resolve } from 'node:path'
import type { BunPlugin } from 'bun'
import { compile, describe } from './index.ts'

// `import source from './x.abide?source'` — the file's own TEXT, as a module.
//
// A `.abide` file is its own source of truth, and something that wants to show what the compiler did
// to it needs both halves: the module, and the text it came from. Reading the text with `Bun.file` is
// the obvious way and it is wrong in the one place it matters — a browser has no `Bun` and no path to
// read from, so a top-level read like that takes the whole page down at import. Going through the
// loader instead means the text is INLINED at build time, so it works in every lane the module does.
//
// It is a separate specifier rather than an import attribute because Bun does not pass attributes to
// a plugin and dedupes the two imports into one module — both would get the compiled form.
//
// The `?source` stays ON the resolved path, and that is load-bearing rather than tidy. The BUNDLER
// keys its module cache on the resolved path and not on the namespace, so resolving to the bare
// `.abide` path handed the second import whichever module the first one had already produced: a file
// imported both ways got the COMPILED module twice, and `compile(LIBRARY)` was handed a component
// function whose `.length` is its arity — `w.slice is not a function`, on the page only, while the
// runtime lane kept the two apart and passed. Keeping the query makes the two paths different keys.
const SOURCE_QUERY = '?source'
const SOURCE_NAMESPACE = 'abide-source'

export const abidePlugin: BunPlugin = {
    name: 'abide',
    setup(build): void {
        build.onResolve({ filter: /\.abide\?source$/ }, (args) => ({
            path: resolve(dirname(args.importer), args.path),
            namespace: SOURCE_NAMESPACE,
        }))
        // A module that exports the string, rather than `loader: 'text'`: the bundler accepts the
        // text loader and the RUNTIME lane does not, and the two lanes have to load this the same way
        // or a demo means something different under `bun test` than it does on the page.
        build.onLoad({ filter: /.*/, namespace: SOURCE_NAMESPACE }, async (args) => ({
            loader: 'js',
            contents: `export default ${JSON.stringify(
                await Bun.file(args.path.slice(0, -SOURCE_QUERY.length)).text(),
            )}`,
        }))
        build.onLoad({ filter: /\.abide$/ }, async (args) => {
            const source = await Bun.file(args.path).text()
            try {
                return { loader: 'ts', contents: compile(source, { filename: args.path }).code }
            } catch (error) {
                // The compiler reports a position in the `.abide` file; a raw throw here would name
                // the plugin instead, which is the one place the author cannot look.
                throw new Error(describe(source, args.path, error))
            }
        })
    },
}

export default abidePlugin
