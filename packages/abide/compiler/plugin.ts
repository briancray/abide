// `.abide` becomes an importable module.
//
// Registered three ways, all of them reaching this one module: the root `bunfig.toml`'s `[test]
// preload` for `bun test`, an `import '$compiler/preload.ts'` in `cli/internal/layers.ts` and
// `cli/internal/repl.ts` (and a `--preload` in `cli/internal/run.ts`) for the server lane, and
// `cli/internal/lane.ts`'s plugin list for the browser bundle. So the SAME compiler output runs in every lane — there is no build
// step whose result could differ from what the tests loaded. An APP never names it: see the example's
// `bunfig.toml`, where `[serve.static] plugins` is the app's own plugins and this one is deliberately
// absent, because naming it again would be the same plugin set up twice.

// `readFileSync` because a Bun plugin's `load` runs SYNCHRONOUSLY and `Bun.file().text()` is a
// promise; `node:path` stands in for nothing, since Bun ships no path api.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { BunPlugin } from 'bun'
import {
    compile,
    describe,
    type ElideOptions,
    elide,
    type ImportedModule,
    SHAPES_FILE,
    TRANSPORT_MODULE,
} from './index.ts'

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

/**
 * The text of a module a transport file imports a TYPE from.
 *
 * Injected into `elide`, which does no I/O of its own — so this is where the filesystem lives and
 * the compiler stays a pure function of text. Read SYNCHRONOUSLY because the derivation is.
 *
 * TWO caches, because the two halves depend on different things: what a specifier resolves to
 * depends on the importer, and what a path holds does not. Keying the read by importer as well made
 * a models module every handler's args come from one `readFileSync` PER TRANSPORT FILE.
 *
 * Relative specifiers resolve beside the importer; anything else goes through Bun's own resolver, so
 * a workspace package works and a tsconfig `paths` alias does not — which costs a shape rather than a
 * build, because a name that does not resolve is one the derivation already knows how to answer.
 */
const RESOLVED = new Map<string, string | null>()
const TEXTS = new Map<string, ImportedModule | null>()

/**
 * What the checker derived, if a build ever ran it.
 *
 * Read ONCE and never required: `abide/compiler/shapes` is a build step, and an app that has not run
 * one gets exactly the shapes the tokens said. It only ever upgrades, so a file that is missing, old,
 * or unreadable costs detail in a published document and nothing else — which is why this swallows
 * every way of failing rather than reporting any of them.
 */
type Checked = NonNullable<ElideOptions['shapes']>

let CHECKED: Checked | null = null

function checked(): Checked {
    if (CHECKED !== null) return CHECKED
    try {
        CHECKED = JSON.parse(readFileSync(resolve(process.cwd(), SHAPES_FILE), 'utf8')) as Checked
    } catch {
        CHECKED = {}
    }
    return CHECKED
}

function moduleFor(specifier: string, importer: string): ImportedModule | null {
    const key = `${importer}\u0000${specifier}`
    // A module that does not resolve or does not read is one with no shape to offer. The build is
    // not this function's to fail: every caller already treats a missing type as unknown.
    let path = RESOLVED.get(key)
    if (path === undefined) {
        try {
            const from = dirname(importer)
            path = specifier.startsWith('.') ? resolve(from, specifier) : Bun.resolveSync(specifier, from)
        } catch {
            path = null
        }
        RESOLVED.set(key, path)
    }
    if (path === null) return null

    const held = TEXTS.get(path)
    if (held !== undefined) return held
    let found: ImportedModule | null = null
    try {
        found = { path, text: readFileSync(path, 'utf8') }
    } catch {
        found = null
    }
    TEXTS.set(path, found)
    return found
}

export const abidePlugin: BunPlugin = {
    name: 'abide',
    setup(build): void {
        // Which LANE this is, and the only discriminator available: the bundler populates
        // `build.config` — `target: "browser"` for both `Bun.build` and the dev server's HTML routes
        // — and a runtime `plugin()` registration leaves it undefined. A wrong answer here ships a
        // database driver to a browser, silently, so `demos/transport.ts` asserts both halves rather
        // than trusting this.
        const browser = (build as { config?: { target?: string } }).config?.target === 'browser'

        // A transport module: the browser gets addresses, the server gets the module plus its own
        // address. Registered on this plugin rather than a second one because an app registers one
        // plugin and both transformations are the same question — what does this lane load?
        build.onLoad({ filter: TRANSPORT_MODULE }, async (args) => {
            const source = await Bun.file(args.path).text()
            try {
                const elided = elide(source, {
                    filename: args.path,
                    browser,
                    resolve: moduleFor,
                    shapes: checked(),
                })
                if (elided === null) return undefined
                return { loader: 'ts', contents: elided.code }
            } catch (error) {
                throw new Error(describe(source, args.path, error))
            }
        })

        // `.ts` as well as `.abide`, because the question "what does this file SAY?" is not about the
        // compiler. A capability whose example is a server module — a lifecycle hook, a config
        // declaration, an endpoint — has an example with nothing to render and text as its whole
        // content, and the reference page that shows it may not read a disk. Nothing below cares which
        // extension it was: the loader strips the query and reads the file.
        build.onResolve({ filter: /\.(abide|ts)\?source$/ }, (args) => ({
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
