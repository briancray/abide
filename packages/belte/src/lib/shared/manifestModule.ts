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
    label: string
    // pages logs its count even at zero (a route-less app is worth surfacing);
    // the other manifests stay quiet when empty.
    logWhenEmpty?: boolean
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
    if (entries.length > 0 || options.logWhenEmpty) {
        log.info(
            `resolved ${entries.length} ${options.label}: ${entries.map((entry) => entry.key).join(', ')}`,
        )
    }
    return { contents: `export const ${options.exportName} = {\n${lines}\n}\n`, loader: 'js' }
}
