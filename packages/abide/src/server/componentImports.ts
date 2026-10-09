// 35.4 — A `.abide` IMPORTED FROM AN APP'S OWN `.ts`, as the component it compiles to. A component
// importing a component is pointed at the compiled module by the compile itself (34.14); a handler
// is not compiled, so its import reached bun as written — and bun loads an extension it has no
// loader for as a `file`, handing the handler the path. `render(Invoice({ invoice }))` then threw
// "Invoice is not a function".
//
// BOUND, NOT RAW. The compiled module is a function of accessors answering its markup (33.4); what
// an app calls is a function of plain props answering a `Component` (35.4), which `render` invokes
// with nothing. The adapter is written into the module the import lands on rather than exported
// from a seam, so no name joins the surface.

import { realpathSync } from 'node:fs' // bun exposes no realpath of its own

/**
 * The plugin landing a `.abide` under `root` on its compiled server module under `compiled`.
 *
 * One per app root: a runtime plugin's `onLoad` is asked in registration order and the first whose
 * filter matches must answer, so the filter carries the root and another app's plugin is never
 * asked. The same object serves the bundler, where `abide compile` follows a handler's imports.
 */
export function componentImports(
    root: string,
    compiled: string,
): Bun.BunPlugin {
    // BOTH SPELLINGS OF THE ROOT, because bun names a file with its symlinks resolved and an app
    // under `/tmp` is `/private/tmp` to it.
    const roots = new Set([root, realpathSync(root)])
    return {
        name: 'abide-component-imports',
        setup(build) {
            for (const at of roots)
                build.onLoad(
                    { filter: new RegExp(`^${RegExp.escape(at)}/.*\\.abide$`) },
                    (args) => ({
                        contents: boundModule(
                            `${compiled}/${args.path.slice(at.length + 1, -'.abide'.length)}.ts`,
                        ),
                        loader: 'js',
                    }),
                )
        },
    }
}

function boundModule(compiledModule: string): string {
    return `import component from ${JSON.stringify(compiledModule)}
export default (props = {}) => {
    const accessors = {}
    for (const key in props) {
        const value = props[key]
        accessors[key] = () => value
    }
    return () => component(accessors)
}
`
}
