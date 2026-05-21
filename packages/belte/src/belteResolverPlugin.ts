// node:fs existsSync — Bun plugin onResolve is sync-only; Bun.file().exists() is async
import { existsSync } from 'node:fs'
import type { BunPlugin } from 'bun'
import { Glob } from 'bun'
import { log } from './lib/shared/log.ts'

const NS = 'belte-virtual'

/*
Bun plugin that resolves belte's `_virtual/*.ts` imports — routes, apis,
layouts, socket, assets, shell — by scanning the consumer app's filesystem
(`src/routes`, `src/socket.ts`, `src/index.html`) and, when `embedAssets`
is set, base64-encoding the already-built `dist/_app/*.gz` into the bundle.
Lets the server and client entries import from stable paths even though
the actual contents are generated at build time.
*/
export function belteResolverPlugin({
    cwd = process.cwd(),
    embedAssets = false,
}: {
    cwd?: string
    embedAssets?: boolean
} = {}): BunPlugin {
    return {
        name: 'belte-resolver',
        setup(build) {
            build.onResolve(
                { filter: /\/_virtual\/(routes|apis|layouts|socket|assets|shell)\.ts$/ },
                (args) => {
                    const name = args.path.split('/').pop()?.replace('.ts', '')
                    if (name === 'socket') {
                        const real = `${cwd}/src/socket.ts`
                        if (existsSync(real)) {
                            return { path: real }
                        }
                        return { path: 'belte:noop', namespace: NS }
                    }
                    if (name === 'routes') {
                        return { path: 'belte:routes', namespace: NS }
                    }
                    if (name === 'apis') {
                        return { path: 'belte:apis', namespace: NS }
                    }
                    if (name === 'layouts') {
                        return { path: 'belte:layouts', namespace: NS }
                    }
                    if (name === 'assets') {
                        return { path: 'belte:assets', namespace: NS }
                    }
                    if (name === 'shell') {
                        return { path: 'belte:shell', namespace: NS }
                    }
                    return undefined
                },
            )

            build.onLoad({ filter: /.*/, namespace: NS }, async (args) => {
                if (args.path === 'belte:routes') {
                    const routesDir = `${cwd}/src/routes`
                    const files = await Array.fromAsync(
                        new Glob('**/*.svelte').scan({ cwd: routesDir }),
                    )
                    const keys = files
                        .filter(
                            (file) =>
                                file !== '_layout.svelte' && !file.endsWith('/_layout.svelte'),
                        )
                        .map((file) => file.replace(/\.svelte$/, ''))
                        .toSorted()
                    const entries = keys
                        .map(
                            (key) =>
                                `    ${JSON.stringify(key)}: () => import(${JSON.stringify(`${routesDir}/${key}.svelte`)}),`,
                        )
                        .join('\n')
                    log.info(`resolved ${keys.length} routes: ${keys.join(', ')}`)
                    return {
                        contents: `export const routes = {\n${entries}\n}\n`,
                        loader: 'js',
                    }
                }
                if (args.path === 'belte:apis') {
                    const routesDir = `${cwd}/src/routes`
                    const files = await Array.fromAsync(
                        new Glob('**/*.ts').scan({ cwd: routesDir }),
                    )
                    const keys = files
                        .filter((file) => file !== '_layout.ts' && !file.endsWith('/_layout.ts'))
                        .map((file) => file.replace(/\.ts$/, ''))
                        .toSorted()
                    const entries = keys
                        .map(
                            (key) =>
                                `    ${JSON.stringify(key)}: () => import(${JSON.stringify(`${routesDir}/${key}.ts`)}),`,
                        )
                        .join('\n')
                    if (keys.length > 0) {
                        log.info(`resolved ${keys.length} apis: ${keys.join(', ')}`)
                    }
                    return {
                        contents: `export const apis = {\n${entries}\n}\n`,
                        loader: 'js',
                    }
                }
                if (args.path === 'belte:layouts') {
                    const routesDir = `${cwd}/src/routes`
                    const viewFiles = await Array.fromAsync(
                        new Glob('**/_layout.svelte').scan({ cwd: routesDir }),
                    )
                    const dataFiles = await Array.fromAsync(
                        new Glob('**/_layout.ts').scan({ cwd: routesDir }),
                    )
                    const layoutEntries = [
                        ...viewFiles.map((file) => ({
                            prefix:
                                file === '_layout.svelte'
                                    ? ''
                                    : file.replace(/\/_layout\.svelte$/, ''),
                            kind: 'view' as const,
                            path: `${routesDir}/${file}`,
                        })),
                        ...dataFiles.map((file) => ({
                            prefix: file === '_layout.ts' ? '' : file.replace(/\/_layout\.ts$/, ''),
                            kind: 'data' as const,
                            path: `${routesDir}/${file}`,
                        })),
                    ]
                    const merged: Record<string, { view?: string; data?: string }> =
                        Object.fromEntries(
                            Map.groupBy(layoutEntries, (entry) => entry.prefix)
                                .entries()
                                .map(([prefix, entries]) => [
                                    prefix,
                                    Object.fromEntries(
                                        entries.map(({ kind, path }) => [kind, path]),
                                    ),
                                ]),
                        )
                    const prefixes = Object.keys(merged).toSorted()
                    const entries = prefixes
                        .map((prefix) => {
                            const parts: string[] = []
                            if (merged[prefix].view) {
                                parts.push(
                                    `view: () => import(${JSON.stringify(merged[prefix].view)})`,
                                )
                            }
                            if (merged[prefix].data) {
                                parts.push(
                                    `resolve: () => import(${JSON.stringify(merged[prefix].data)})`,
                                )
                            }
                            return `    ${JSON.stringify(prefix)}: { ${parts.join(', ')} },`
                        })
                        .join('\n')
                    if (prefixes.length > 0) {
                        const summary = prefixes
                            .map((prefix) => {
                                const tags = [
                                    merged[prefix].view && 'view',
                                    merged[prefix].data && 'data',
                                ].filter(Boolean)
                                return `${prefix || '(root)'}[${tags.join('+')}]`
                            })
                            .join(', ')
                        log.info(`resolved ${prefixes.length} layouts: ${summary}`)
                    }
                    return {
                        contents: `export const layouts = {\n${entries}\n}\n`,
                        loader: 'js',
                    }
                }
                if (args.path === 'belte:assets') {
                    if (!embedAssets) {
                        return { contents: 'export const assets = undefined', loader: 'js' }
                    }
                    const appDir = `${cwd}/dist/_app`
                    const files = await Array.fromAsync(
                        new Glob('**/*.gz').scan({ cwd: appDir, onlyFiles: true }),
                    )
                    const encoded = await Promise.all(
                        files.map(async (file) => {
                            const bytes = await Bun.file(`${appDir}/${file}`).bytes()
                            const urlPath = `/_app/${file.replace(/\.gz$/, '')}`
                            return {
                                line: `    ${JSON.stringify(urlPath)}: _d(${JSON.stringify(bytes.toBase64())}),`,
                                bytes: bytes.byteLength,
                            }
                        }),
                    )
                    const entries = encoded.map((entry) => entry.line)
                    const totalBytes = encoded.reduce((total, entry) => total + entry.bytes, 0)
                    log.info(
                        `embedded ${encoded.length} gzipped assets from dist/_app/ (${(totalBytes / 1024).toFixed(1)} KiB)`,
                    )
                    return {
                        contents: `const _d = (s) => Uint8Array.fromBase64(s)
export const assets = {
${entries.join('\n')}
}
`,
                        loader: 'js',
                    }
                }
                if (args.path === 'belte:shell') {
                    const userShell = `${cwd}/src/index.html`
                    const defaultShell = new URL('./assets/index.html', import.meta.url).pathname
                    const filepath = (await Bun.file(userShell).exists()) ? userShell : defaultShell
                    const content = await Bun.file(filepath).text()
                    if (filepath === userShell) {
                        log.info('using custom src/index.html')
                    }
                    return {
                        contents: `export const shell = ${JSON.stringify(content)}`,
                        loader: 'js',
                    }
                }
                if (args.path === 'belte:noop') {
                    return { contents: 'export {};', loader: 'js' }
                }
                return undefined
            })
        },
    }
}
