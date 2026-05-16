// node:fs existsSync — Bun plugin onResolve is sync-only; Bun.file().exists() is async
import { existsSync } from 'node:fs'
import type { BunPlugin } from 'bun'
import { Glob } from 'bun'
import { log } from './lib/shared/log.ts'

const NS = 'belte-virtual'

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
                        .filter((f) => f !== '_layout.svelte' && !f.endsWith('/_layout.svelte'))
                        .map((f) => f.replace(/\.svelte$/, ''))
                        .toSorted()
                    const entries = keys
                        .map(
                            (k) =>
                                `    ${JSON.stringify(k)}: () => import(${JSON.stringify(`${routesDir}/${k}.svelte`)}),`,
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
                        .filter((f) => f !== '_layout.ts' && !f.endsWith('/_layout.ts'))
                        .map((f) => f.replace(/\.ts$/, ''))
                        .toSorted()
                    const entries = keys
                        .map(
                            (k) =>
                                `    ${JSON.stringify(k)}: () => import(${JSON.stringify(`${routesDir}/${k}.ts`)}),`,
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
                    const merged = [
                        ...viewFiles.map((f) => ({
                            prefix:
                                f === '_layout.svelte' ? '' : f.replace(/\/_layout\.svelte$/, ''),
                            kind: 'view' as const,
                            path: `${routesDir}/${f}`,
                        })),
                        ...dataFiles.map((f) => ({
                            prefix: f === '_layout.ts' ? '' : f.replace(/\/_layout\.ts$/, ''),
                            kind: 'data' as const,
                            path: `${routesDir}/${f}`,
                        })),
                    ].reduce<Record<string, { view?: string; data?: string }>>(
                        (acc, { prefix, kind, path }) => ({
                            ...acc,
                            [prefix]: { ...acc[prefix], [kind]: path },
                        }),
                        {},
                    )
                    const prefixes = Object.keys(merged).toSorted()
                    const entries = prefixes
                        .map((p) => {
                            const parts: string[] = []
                            if (merged[p].view) {
                                parts.push(`view: () => import(${JSON.stringify(merged[p].view)})`)
                            }
                            if (merged[p].data) {
                                parts.push(
                                    `resolve: () => import(${JSON.stringify(merged[p].data)})`,
                                )
                            }
                            return `    ${JSON.stringify(p)}: { ${parts.join(', ')} },`
                        })
                        .join('\n')
                    if (prefixes.length > 0) {
                        const summary = prefixes
                            .map((p) => {
                                const tags = [
                                    merged[p].view && 'view',
                                    merged[p].data && 'data',
                                ].filter(Boolean)
                                return `${p || '(root)'}[${tags.join('+')}]`
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
                        files.map(async (f) => {
                            const buf = await Bun.file(`${appDir}/${f}`).bytes()
                            const urlPath = `/_app/${f.replace(/\.gz$/, '')}`
                            return {
                                line: `    ${JSON.stringify(urlPath)}: _d(${JSON.stringify(buf.toBase64())}),`,
                                bytes: buf.byteLength,
                            }
                        }),
                    )
                    const entries = encoded.map((e) => e.line)
                    const bytes = encoded.reduce((a, b) => a + b.bytes, 0)
                    log.info(
                        `embedded ${encoded.length} gzipped assets from dist/_app/ (${(bytes / 1024).toFixed(1)} KiB)`,
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
