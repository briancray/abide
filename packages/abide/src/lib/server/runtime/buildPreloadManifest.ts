import { existsSync } from 'node:fs'
import { Glob, gunzipSync } from 'bun'
import { layoutChainForRoute } from '../../shared/layoutChainForRoute.ts'
import type { Assets } from './types/Assets.ts'

/* A static-import specifier in a built chunk: `import {…} from "./chunk.js"` and
   side-effect `import "./chunk.js"`, minified or not. The leading `import` plus the
   `[^"'()]` guard excludes dynamic `import("./page-….js")` — so only the runtime graph
   matches, never a lazy route chunk. Mirrors the shell injector in abideResolverPlugin. */
const STATIC_IMPORT = /import\s*(?:[^"'()]*?\bfrom\s*)?["']\.\/([\w.-]+\.js)["']/g

/* A pages/layouts manifest entry in the entry chunk:
   `"<route>": () => import("./page-<hash>.js")` (page chunk) or the layout form.
   The route/layout key plus its lazily-loaded chunk — the only place route → chunk is
   recorded, since every page chunk shares the `page-` stem and can't be told apart by name. */
const ROUTE_CHUNK = /"(\/[^"]*)"\s*:\s*\(\)\s*=>\s*import\("\.\/((?:page|layout)-[\w.-]+\.js)"\)/g

/* Reads a `_app` chunk's source by filename — gunzipped from the embedded asset map
   (standalone compile) or off disk (dev + `abide start`). Undefined on a miss. */
function chunkReader(
    appDir: string,
    assets?: Assets,
): (name: string) => Promise<string | undefined> {
    if (assets) {
        return async (name) => {
            const bytes = assets[`/_app/${name}`]
            return bytes ? new TextDecoder().decode(gunzipSync(bytes)) : undefined
        }
    }
    return async (name) => {
        const file = Bun.file(`${appDir}/${name}`)
        return (await file.exists()) ? file.text() : undefined
    }
}

/* The hashed client entry filename (`client-<hash>.js`), from the asset map or disk.
   Each build's `appDir` holds exactly one entry (production `_app`, or a dev
   generation dir), so `.find` is unambiguous. */
async function findEntry(appDir: string, assets?: Assets): Promise<string | undefined> {
    const isEntry = (name: string): boolean => /^client-[a-z0-9]+\.js$/i.test(name)
    if (assets) {
        const key = Object.keys(assets).find((path) => isEntry(path.replace('/_app/', '')))
        return key?.replace('/_app/', '')
    }
    if (!existsSync(appDir)) {
        return undefined
    }
    const names = await Array.fromAsync(
        new Glob('client-*.js').scan({ cwd: appDir, onlyFiles: true }),
    )
    return names.find(isEntry)
}

/*
Maps each page route to the extra `_app` chunks worth preloading for it: the route's
page chunk, its layout-chain chunks, and the transitive static-import closure of each
— minus the entry's own static graph, which the shell already preloads. Built once at
server boot from the built bundle (the route → chunk mapping lives in the entry's
compiled pages/layouts manifest; the static graph is parsed from each chunk's source).

Those route chunks are dynamically imported by the entry, so the browser can't discover
them until it has downloaded, parsed, and RUN the entry — on a streamed page that's
~stream-close. Preloading them per render (the renderer knows the matched route) lets
the route's whole chain transfer DURING the stream, so hydration is network-ready at
stream-close instead of waterfalling after it. Returns an empty map when the bundle is
absent or unparseable, so rendering degrades to the entry-only preload.
*/
export async function buildPreloadManifest({
    appDir,
    assets,
}: {
    appDir: string
    assets?: Assets
}): Promise<Record<string, string[]>> {
    const read = chunkReader(appDir, assets)
    const entryName = await findEntry(appDir, assets)
    const entrySource = entryName ? await read(entryName) : undefined
    if (entryName === undefined || entrySource === undefined) {
        return {}
    }

    /* route/layout key → its lazy chunk, split by the page-/layout- stem. */
    const pageChunk: Record<string, string> = {}
    const layoutChunk: Record<string, string> = {}
    for (const match of entrySource.matchAll(ROUTE_CHUNK)) {
        /* Both capture groups are present whenever the regex matches. */
        const key = match[1] as string
        const chunk = match[2] as string
        if (chunk.startsWith('page-')) {
            pageChunk[key] = chunk
        } else {
            layoutChunk[key] = chunk
        }
    }

    /* Memoised direct static imports per chunk; closure walks them to a fixpoint. */
    const directCache = new Map<string, Promise<string[]>>()
    const direct = (name: string): Promise<string[]> => {
        const cached = directCache.get(name)
        if (cached) {
            return cached
        }
        const deps = read(name).then((source) =>
            source
                ? [
                      ...new Set(
                          [...source.matchAll(STATIC_IMPORT)].map((match) => match[1] as string),
                      ),
                  ]
                : [],
        )
        directCache.set(name, deps)
        return deps
    }
    const closure = async (name: string): Promise<Set<string>> => {
        const seen = new Set<string>()
        const queue = [name]
        while (queue.length > 0) {
            const current = queue.shift() as string
            if (seen.has(current)) {
                continue
            }
            seen.add(current)
            for (const dependency of await direct(current)) {
                if (!seen.has(dependency)) {
                    queue.push(dependency)
                }
            }
        }
        return seen
    }

    /* The entry + its static runtime — already preloaded by the shell, so excluded. */
    const excluded = await closure(entryName)
    const layoutKeys = Object.keys(layoutChunk)
    const manifest: Record<string, string[]> = {}
    for (const route of Object.keys(pageChunk)) {
        const chunks = new Set<string>(await closure(pageChunk[route] as string))
        for (const key of layoutChainForRoute(route, layoutKeys)) {
            const chunk = layoutChunk[key]
            if (chunk) {
                for (const dependency of await closure(chunk)) {
                    chunks.add(dependency)
                }
            }
        }
        const preload = [...chunks].filter((chunk) => !excluded.has(chunk))
        if (preload.length > 0) {
            manifest[route] = preload
        }
    }
    return manifest
}
