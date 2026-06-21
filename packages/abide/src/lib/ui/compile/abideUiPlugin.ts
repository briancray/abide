import { relative } from 'node:path'
import type { BunPlugin } from 'bun'
import { messageFromError } from '../../shared/messageFromError.ts'
import { AbideCompileError } from './AbideCompileError.ts'
import { analyzeComponent } from './analyzeComponent.ts'
import { compileModule } from './compileModule.ts'
import { nearestProjectRoot } from './nearestProjectRoot.ts'
import { offsetToLineColumn } from './offsetToLineColumn.ts'

/*
Bun plugin that loads `.abide` single-file components: compiles each to the ES
module `compileModule` emits, so they import and mount like any other module. The
only UI loader in the dev/build/preload pipeline; the emitted module's
`abide/ui/*` imports resolve through the package exports.

A `layout.abide` compiles as a layout: its `<slot/>` lowers to the router's page
outlet (`<abide-outlet>`) rather than a passed-children slot — the file's role is
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

        build.onLoad({ filter: /\.abide$/ }, async (args) => {
            const source = await Bun.file(args.path).text()
            const moduleId = relative(nearestProjectRoot(args.path, process.cwd()), args.path)
            const isLayout = (args.path.split('/').pop() ?? '') === 'layout.abide'
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
            const code = compileAbide(() => compileModule(source, { isLayout, moduleId }))
            /* Browser build with `<style>`(s): concatenate every scoped block's CSS and
               pull it into the bundle via one virtual import, keyed by `moduleId` so the
               registry id and the CSS id agree. */
            const styles = compileAbide(() =>
                toBrowser ? analyzeComponent(source, moduleId).styles : [],
            )
            if (styles.length === 0) {
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
