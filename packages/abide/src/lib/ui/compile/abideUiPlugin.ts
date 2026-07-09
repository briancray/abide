import { relative } from 'node:path'
import type { BunPlugin } from 'bun'
import { isLayoutFile } from '../../shared/isLayoutFile.ts'
import { messageFromError } from '../../shared/messageFromError.ts'
import { AbideCompileError } from './AbideCompileError.ts'
import { compileModule } from './compileModule.ts'
import type { ShadowProgram } from './createShadowProgram.ts'
import { interpolationClassifierForRoot } from './interpolationClassifierForRoot.ts'
import { nearestProjectRoot } from './nearestProjectRoot.ts'
import { offsetToLineColumn } from './offsetToLineColumn.ts'
import { seedTypeClassifierForRoot } from './seedTypeClassifierForRoot.ts'

/*
Bun plugin that loads `.abide` single-file components: compiles each to the ES
module `compileModule` emits, so they import and mount like any other module. The
only UI loader in the dev/build/preload pipeline; the emitted module's
`abide/ui/*` imports resolve through the package exports.

A `layout.abide` compiles as a layout: its `<slot/>` lowers to the router's page
outlet (a `<!--abide:outlet-->…<!--/abide:outlet-->` comment boundary the router fills) rather than a passed-children slot — the file's role is
its name, so the loader flags it from the path stem.

The emitted module embeds the component's `<script>` and `{expr}` bodies verbatim,
so it carries the author's TypeScript (a typed `prop`, an annotated handler). The
`ts` loader strips those annotations — the generated runtime code is valid TS too —
keeping `.abide` scripts the TypeScript that `abide check` type-checks them as.

A component's scoped `<style>`(s) are bundled, not inlined: in the BROWSER build the
module imports a virtual `abide-style:` CSS module holding every block's scoped CSS
concatenated, so Bun folds it into the entry stylesheet (`client.css`, already linked
by the shell). Server builds (target `bun`) omit the import — SSR styling comes from
that same linked sheet, so a page renders styled before the client bundle loads, with
no inlined `<style>`. The elements still carry their `data-a-…` scope attributes
either way (one per `<style>` covering them — see `analyzeComponent`).
*/
// @documentation plumbing
export const abideUiPlugin: BunPlugin = {
    name: 'abide-ui',
    setup(build) {
        const toBrowser = build.config?.target === 'browser'
        /* Scoped CSS keyed by its virtual specifier, filled as each `.abide` loads and
           read back when Bun resolves the matching `abide-style:` import (browser only). */
        const cssByVirtual = new Map<string, string>()
        /* One WARM shadow program per project root (ADR-0019, Stage B): the checker +
           per-file mappings type-directed lowering needs, built lazily on first `.abide`
           in a root and reused for every component there — not rebuilt per module. */
        const shadowByRoot = new Map<string, ShadowProgram | undefined>()

        build.onLoad({ filter: /\.abide$/ }, async (args) => {
            const source = await Bun.file(args.path).text()
            const root = nearestProjectRoot(args.path, process.cwd())
            const moduleId = relative(root, args.path)
            const isLayout = isLayoutFile(args.path)
            /* The classifier for this file over its root's warm shadow program. Fail-open:
               a program that can't build (or a file with no shadow) yields `undefined`, so
               the module compiles exactly as before. */
            const classify = interpolationClassifierForRoot(shadowByRoot, root, args.path)
            /* The seed classifier for this file over the SAME warm shadow program (ADR-0023):
               reuses the `shadowByRoot` cache `classify` just warmed, so no second program is
               built. Fail-open identically — a no-marker `computed(seed)` routes by type when
               it resolves, else by the `isBareCallComputed` syntax heuristic. */
            const seedClassify = seedTypeClassifierForRoot(shadowByRoot, root, args.path)
            /* Bun frames a plugin throw at `<file>:0` regardless of the real spot, so
               carry the component path + resolved line:col in the message — otherwise a
               control-flow / compile error reads as `:0` and (in deep imports) can look
               like it came from the entry page rather than this component. */
            const compileAbide = <T>(step: () => T): T => {
                try {
                    return step()
                } catch (error) {
                    const offset = error instanceof AbideCompileError ? error.offset : undefined
                    const at =
                        offset === undefined
                            ? moduleId
                            : (({ line, column }) => `${moduleId}:${line}:${column}`)(
                                  offsetToLineColumn(source, offset),
                              )
                    const message = messageFromError(error)
                    throw new Error(`${message.replace(/^\[abide\]\s*/, `[abide] ${at} — `)}`)
                }
            }
            /* One compile pass yields both the module code and its scoped `<style>` blocks —
               the styles come from the analysis `compileModule` already ran, so the loader no
               longer re-analyzes the source just to recover them. */
            const { code, styles } = compileAbide(() =>
                compileModule(source, { isLayout, moduleId, classify, seedClassify }),
            )
            /* Browser build with `<style>`(s): concatenate every scoped block's CSS and
               pull it into the bundle via one virtual import, keyed by `moduleId` so the
               registry id and the CSS id agree. Server builds skip the import (SSR styling
               comes from the already-linked sheet). */
            if (!toBrowser || styles.length === 0) {
                return { contents: code, loader: 'ts' }
            }
            const virtual = `abide-style:${moduleId}`
            cssByVirtual.set(virtual, styles.map((style) => style.css).join('\n'))
            return { contents: `import ${JSON.stringify(virtual)}\n${code}`, loader: 'ts' }
        })

        build.onResolve({ filter: /^abide-style:/ }, (args) => ({
            path: args.path,
            namespace: 'abide-style',
        }))
        build.onLoad({ filter: /.*/, namespace: 'abide-style' }, (args) => ({
            contents: cssByVirtual.get(args.path) ?? '',
            loader: 'css',
        }))
    },
}
