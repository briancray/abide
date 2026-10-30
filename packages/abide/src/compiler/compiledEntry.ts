import { tablePath } from '#server/abideModules.ts'
import type { AppPackage } from '#server/config.ts'
import type { SourceMaps } from '#server/installSourceMaps.ts'
import { SERVER_TABLE } from '#server/TABLES.ts'
import abidePackage from '../../package.json' with { type: 'json' }

// What the executable starts from: `abide compile`'s, and `abide bundle`'s window over it (38.70).
const INSTALL_SOURCE_MAPS = Bun.fileURLToPath(
    new URL('../server/installSourceMaps.ts', import.meta.url),
)

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
 * 38.56 — the compiler is not among them: the executable does not hold it.
 */
function abideEntries(): Map<string, string> {
    const specifiers = new Map<string, string>()
    for (const [entry, path] of Object.entries(abidePackage.exports)) {
        // The compiler, and the preload a test run builds the app with (38.109), are no part of an
        // app that is already built.
        if (
            entry === './compiler' ||
            entry === './test' ||
            !path.endsWith('.ts')
        )
            continue
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
 * 38.10 — every part `runCompiled` boots over, named by a static import the bundler follows into
 * the executable. 38.44 — NOTHING IN IT IS FOUND AT RUN TIME — a file this module does not name is
 * a file the executable does not hold, which is what makes the artifact a property of the build
 * rather than of the machine it lands on.
 *
 * A file the app SERVES is imported as a `file`, so its bytes are embedded as they are and it is
 * answered through a path like any other; a module the app RUNS is imported as code. Every path is
 * absolute, so the entry means the same thing wherever `--out` put it.
 */
export function compiledEntry(app: {
    /**
     * 38.70 — what `abide bundle` read of the launcher's files: `launch` the path of its
     * `launcher.abide` where that file has markup of its own; `undefined` for `abide compile`.
     */
    desktop:
        | {
              launch: string | undefined
              document: string
              icon: string | undefined
              accent: string | undefined
          }
        | undefined
    /** The app's root, below which the server's table is served (`abideModules`). */
    root: string
    /** 38.97 — each server module's map, by the `.abide` it is served at. */
    sourceMaps: SourceMaps
    package: AppPackage
    manifest: unknown
    /** Every file under the build's `client/`, by name to the file. */
    client: Map<string, string>
    /** Every file under the build's `public/`, by name to the file. */
    published: Map<string, string>
}): string {
    const runner = RUNNERS[app.desktop === undefined ? 'compiled' : 'desktop']
    let imports = `import { ${runner.name} } from ${JSON.stringify(runner.path)}
import { installSourceMaps } from ${JSON.stringify(INSTALL_SOURCE_MAPS)}
import * as table from ${JSON.stringify(tablePath(app.root, SERVER_TABLE))}
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
    let specifiers = ''
    for (const [specifier, path] of abideEntries())
        specifiers += `\n    ${JSON.stringify(specifier)}: () => import(${JSON.stringify(path)}),`
    const desktop =
        app.desktop === undefined
            ? ''
            : `
    {
        launch: ${app.desktop.launch === undefined ? 'undefined' : `() => import(${JSON.stringify(app.desktop.launch)})`},
        document: ${JSON.stringify(app.desktop.document)},
        icon: ${JSON.stringify(app.desktop.icon)},
        accent: ${JSON.stringify(app.desktop.accent)},
    },`
    return `// Written by \`abide compile\`. The whole app, as what one executable holds.
${imports}
// 38.56 — a file declaring handlers as a script names it through the app's one alias:
// \`#src/invoices/getInvoice.handler.ts\`, to the module it is.
const declared = {}
for (const row of table.handlers) declared[\`#src/\${row.source}\`] = row.load

// 38.97 — before anything runs, a script \`run\` included: the executable's frames name each
// \`.abide\` as it was bundled.
installSourceMaps(${JSON.stringify(app.sourceMaps)}, undefined)

await ${runner.name}(
    // 37.1 — every server block, imported before the boot.
    {
        hooks: () => Promise.all(table.servers.map((load) => load())),
        package: ${JSON.stringify(app.package)},
    },
    {
        table,
        handlers: table.handlers,
        manifest: ${JSON.stringify(app.manifest)},
        client: ${client},
        published: ${published},
    },
    {${specifiers}
        ...declared,
    },${desktop}
)
`
}
