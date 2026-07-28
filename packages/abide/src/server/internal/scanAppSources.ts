// scanAppSources(dir) — WHICH FILES an abide project is made of, and what each one is CALLED.
//
// The filesystem is the source of truth (abide-compiler C6), and two surfaces read it: `loadApp`
// IMPORTS these modules to boot a live app, and `abide compile` STATICALLY IMPORTS them into a
// standalone binary. Both need the same derivation — rpc path under `rpc/` without extension
// (`rpc/users/list.ts` → "users/list"), page path from the folder chain (`pages/about/page.abide` →
// "/about"), layout prefix from its directory, socket name from the filename stem — so the rule lives
// here once rather than in each caller.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { layoutRoutePrefix } from './layouts.ts'
import { routePrefixFromRelative } from './routePrefixFromRelative.ts'

export interface AppSources {
    // Absolute paths, each with the name its surface is addressed by.
    rpc: { name: string; path: string }[]
    sockets: { name: string; path: string }[]
    // `dir` is the source's own directory — what resolves its relative CSS/component imports.
    pages: { route: string; path: string; dir: string }[]
    layouts: { prefix: string; path: string; dir: string }[]
    // Present only when the project has them; both are optional.
    app: string | undefined
    config: string | undefined
}

// Enumerate files matching `pattern` under `baseDir`, returning POSIX-relative paths. A missing base
// dir yields nothing (Bun.Glob.scan simply finds no matches). Sorted so a build is reproducible.
async function scanFiles(baseDir: string, pattern: string): Promise<string[]> {
    if (!existsSync(baseDir)) return []
    const glob = new Bun.Glob(pattern)
    const found: string[] = []
    for await (const relative of glob.scan({ cwd: baseDir, onlyFiles: true })) {
        found.push(relative)
    }
    found.sort()
    return found
}

export async function scanAppSources(dir: string): Promise<AppSources> {
    const rpcDir = join(dir, 'src/server/rpc')
    const socketsDir = join(dir, 'src/server/sockets')
    const pagesDir = join(dir, 'src/ui/pages')

    const rpc: AppSources['rpc'] = []
    for (const relative of await scanFiles(rpcDir, '**/*.ts')) {
        rpc.push({ name: relative.replace(/\.ts$/, ''), path: join(rpcDir, relative) })
    }

    const sockets: AppSources['sockets'] = []
    for (const relative of await scanFiles(socketsDir, '*.ts')) {
        sockets.push({ name: relative.replace(/\.ts$/, ''), path: join(socketsDir, relative) })
    }

    const pages: AppSources['pages'] = []
    for (const relative of await scanFiles(pagesDir, '**/page.abide')) {
        const path = join(pagesDir, relative)
        pages.push({
            route: routePrefixFromRelative(relative, 'page.abide'),
            path,
            dir: dirname(path),
        })
    }

    const layouts: AppSources['layouts'] = []
    for (const relative of await scanFiles(pagesDir, '**/layout.abide')) {
        const path = join(pagesDir, relative)
        layouts.push({ prefix: layoutRoutePrefix(relative), path, dir: dirname(path) })
    }

    const appPath = join(dir, 'src/app.ts')
    const configPath = join(dir, 'src/server/config.ts')
    return {
        rpc,
        sockets,
        pages,
        layouts,
        app: existsSync(appPath) ? appPath : undefined,
        config: existsSync(configPath) ? configPath : undefined,
    }
}
