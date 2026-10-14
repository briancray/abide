// 38.108 — THE APP'S MAP: every address it answers, the file answering each, and where every hook is
// filed. What `abide routes` prints, off the build's own reading of the tree — the routes and the
// handler mounts `compileApp` answers with — so the map and what the server answers are one walk.
//
// THE HOOKS ARE READ, NOT RUN, as the handlers are: a call of one of abide's hooks in a `.abide`'s
// scripts or a handler file — its own or a mounted package's — at the route 37.1 files it at, off the
// same layout the build compiled (`hookCalls`).

import { compileApp, openChecker } from './compileApp.ts'

/** One address the app answers, and the file answering it. */
type MappedRoute = {
    method: string
    address: string
    file: string
    kind: 'page' | 'handler' | 'private'
}

/** One hook call, the route it is filed at, and the file making it. */
type MappedHook = { hook: string; route: string; file: string }

/** Every address the app at `root` answers, and every hook it files. */
export async function appMap(
    root: string,
): Promise<{ routes: MappedRoute[]; hooks: MappedHook[] }> {
    const checker = await openChecker(root)
    let app: Awaited<ReturnType<typeof compileApp>>
    let layout: Awaited<ReturnType<typeof checker.layout>>
    try {
        app = await compileApp(root, checker)
        layout = await checker.layout()
    } finally {
        await checker.close()
    }
    const routes: MappedRoute[] = []
    for (const route of app.routes)
        routes.push({
            method: 'GET',
            address: route.pattern,
            file: route.source,
            kind: 'page',
        })
    for (const mount of app.mounts)
        routes.push({
            method: mount.method,
            address: mount.address,
            file: mount.source,
            kind: mount.private ? 'private' : 'handler',
        })
    routes.sort((one, two) =>
        one.address === two.address
            ? one.method < two.method
                ? -1
                : 1
            : one.address < two.address
              ? -1
              : 1,
    )
    const hooks: MappedHook[] = []
    // A package's component the app imports, mounted nowhere, is the package's own to map.
    for (const source of layout.sources)
        if (source.place !== 'dependency')
            for (const hook of source.hooks)
                hooks.push({ hook, route: source.scope, file: source.relative })
    for (const file of layout.handlers)
        for (const hook of file.hooks)
            hooks.push({ hook, route: file.scope, file: file.relative })
    return { routes, hooks }
}

/** The map as `abide routes` prints it: one line an address, then one a hook. */
export function mapText(map: Awaited<ReturnType<typeof appMap>>): string {
    const lines: string[] = []
    const width = (values: string[]): number =>
        values.reduce((most, value) => Math.max(most, value.length), 0)
    const methods = width(map.routes.map((route) => route.method))
    const addresses = width(map.routes.map((route) => route.address))
    for (const route of map.routes)
        lines.push(
            `${route.method.padEnd(methods)}  ${route.address.padEnd(addresses)}  ${route.file}${route.kind === 'private' ? '  (private)' : ''}`,
        )
    if (map.hooks.length > 0) {
        lines.push('', 'hooks')
        const hooks = width(map.hooks.map((hook) => hook.hook))
        const routes = width(map.hooks.map((hook) => hook.route))
        for (const hook of map.hooks)
            lines.push(
                `  ${hook.hook.padEnd(hooks)}  ${hook.route.padEnd(routes)}  ${hook.file}`,
            )
    }
    return lines.join('\n')
}
