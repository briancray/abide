import { log } from './log.ts'

/*
Builds one of belte's virtual manifest modules — the `{ key: () => import(...) }`
map the bundler emits for rpc / sockets / prompts / pages / layouts. They differ
only in their files, the key derived per file, the import dir, the export name,
and the log label; this is the single shape they share.
*/
export function manifestModule(options: {
    files: string[]
    keyForFile: (file: string) => string
    importDir: string
    exportName: string
    /*
    A plain `resolved N <label>: keys` line at build time, when set. Omitted for
    manifests whose contents are enumerated once at boot as an aligned table (see
    logExposedSurfaces) — rpc/sockets/pages/layouts — which both avoids the
    redundant list and the double-log of manifests (pages/layouts) loaded by both
    the server and client bundles. prompts/errors have no table, so they pass a
    label to keep their build-time line.
    */
    label?: string
}): { contents: string; loader: 'js' } {
    const entries = options.files
        .toSorted()
        .map((file) => ({ key: options.keyForFile(file), file }))
    const lines = entries
        .map(
            ({ key, file }) =>
                `    ${JSON.stringify(key)}: () => import(${JSON.stringify(`${options.importDir}/${file}`)}),`,
        )
        .join('\n')
    if (options.label && entries.length > 0) {
        log.info(
            `resolved ${entries.length} ${options.label}: ${entries.map((entry) => entry.key).join(', ')}`,
        )
    }
    return { contents: `export const ${options.exportName} = {\n${lines}\n}\n`, loader: 'js' }
}
