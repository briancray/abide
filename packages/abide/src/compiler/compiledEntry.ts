import type { AppPackage } from '#server/config.ts'
import type { LauncherOptions } from '#server/launcherOptions.ts'
import abidePackage from '../../package.json' with { type: 'json' }

// What the executable starts from: `abide compile`'s, and `abide bundle`'s window over it (38.71).
const RUNNERS = {
    compiled: {
        name: 'runCompiled',
        path: Bun.fileURLToPath(
            new URL('../server/runCompiled.ts', import.meta.url),
        ),
    },
    desktop: {
        name: 'runDesktop',
        path: Bun.fileURLToPath(
            new URL('../server/runDesktop.ts', import.meta.url),
        ),
    },
}
const PACKAGE = Bun.fileURLToPath(new URL('../../', import.meta.url))

/**
 * Abide's own package entries, by the specifier an app imports each with, to the module behind it.
 *
 * 38.57 — the compiler is not among them: the executable does not hold it.
 */
function abideEntries(): Map<string, string> {
    const specifiers = new Map<string, string>()
    for (const [entry, path] of Object.entries(abidePackage.exports)) {
        if (entry === './compiler' || !path.endsWith('.ts')) continue
        specifiers.set(
            entry === '.'
                ? abidePackage.name
                : `${abidePackage.name}/${entry.slice(2)}`,
            `${PACKAGE}${path.slice(2)}`,
        )
    }
    return specifiers
}

/**
 * The source of the module a compiled app starts from, written into the build beside `server.ts`.
 *
 * 38.11 — every part `runCompiled` boots over, named by a static import the bundler follows into
 * the executable. 38.45 — NOTHING IN IT IS FOUND AT RUN TIME — a file this module does not name is
 * a file the executable does not hold, which is what makes the artifact a property of the build
 * rather than of the machine it lands on.
 *
 * A file the app SERVES is imported as a `file`, so its bytes are embedded as they are and it is
 * answered through a path like any other; a module the app RUNS is imported as code. Every path is
 * absolute, so the entry means the same thing wherever `--out` put it.
 */
export function compiledEntry(app: {
    /**
     * 38.71 — what `abide bundle` read out of `src/bundle/`, and `launch` the path of its
     * `launch.abide`; `undefined` for `abide compile`.
     */
    desktop:
        | {
              options: LauncherOptions
              launch: string | undefined
              shell: string
          }
        | undefined
    out: string
    /** 37.1 — `src/server/app.ts`, where the app has one. */
    hooks: string | undefined
    package: AppPackage
    shell: string
    manifest: unknown
    /** 16.2 — each handler's source path as its row names it, to the file. */
    handlerModules: Map<string, string>
    /** Every file under the build's `client/`, by name to the file. */
    client: Map<string, string>
    /** Every file under the build's `public/`, by name to the file. */
    published: Map<string, string>
}): string {
    const runner = RUNNERS[app.desktop === undefined ? 'compiled' : 'desktop']
    let imports = `import { ${runner.name} } from ${JSON.stringify(runner.path)}
import * as table from ${JSON.stringify(`${app.out}/server.ts`)}
import { handlers } from ${JSON.stringify(`${app.out}/rpc.ts`)}
`
    const files = (kind: string, paths: Map<string, string>): string => {
        let entries = ''
        let index = 0
        for (const [name, path] of paths) {
            imports += `import ${kind}${index} from ${JSON.stringify(path)} with { type: 'file' }\n`
            entries += `\n        [${JSON.stringify(name)}, ${kind}${index}],`
            index += 1
        }
        return `new Map([${entries}\n    ])`
    }
    const client = files('client', app.client)
    const published = files('published', app.published)
    let modules = ''
    for (const [source, path] of app.handlerModules)
        modules += `\n    ${JSON.stringify(source)}: () => import(${JSON.stringify(path)}),`
    // A handler module as a script names it: `#server/rpc/invoices`, with or without its extension.
    let specifiers = ''
    for (const [specifier, path] of abideEntries())
        specifiers += `\n    ${JSON.stringify(specifier)}: () => import(${JSON.stringify(path)}),`
    for (const source of app.handlerModules.keys())
        for (const specifier of [
            `#${source}`,
            `#${source.replace(/\.ts$/, '')}`,
        ])
            specifiers += `\n    ${JSON.stringify(specifier)}: handlerModules[${JSON.stringify(source)}],`
    const hooks =
        app.hooks === undefined
            ? 'undefined'
            : `() => import(${JSON.stringify(app.hooks)})`
    const desktop =
        app.desktop === undefined
            ? ''
            : `
    {
        options: ${JSON.stringify(app.desktop.options)},
        launch: ${app.desktop.launch === undefined ? 'undefined' : `() => import(${JSON.stringify(app.desktop.launch)})`},
        shell: ${JSON.stringify(app.desktop.shell)},
    },`
    return `// Written by \`abide compile\`. The whole app, as what one executable holds.
${imports}
const handlerModules = {${modules}
}

await ${runner.name}(
    { hooks: ${hooks}, package: ${JSON.stringify(app.package)} },
    {
        table,
        handlers,
        handlerModule: (source) => handlerModules[source](),
        shell: ${JSON.stringify(app.shell)},
        manifest: ${JSON.stringify(app.manifest)},
        client: ${client},
        published: ${published},
    },
    {${specifiers}
    },${desktop}
)
`
}
