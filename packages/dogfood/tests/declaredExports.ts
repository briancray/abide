// EVERY NAME THE PUBLIC ENTRY POINTS EXPORT, read off their barrels: what an app can import, for the
// gate that every one of them is a name REGISTRY writes (`coverage.test.ts`).

/** The scope an entry's names are written in: abide's, or the `@abide/harness/…` entry's own. */
export function scopeOf(entry: string): string {
    return entry.startsWith('@abide/abide') ? 'abide' : entry
}

const PACKAGES = new URL('../../', import.meta.url).pathname

/** The entry points an app imports from, in the order a name exported by two is filed under. */
async function entryPoints(): Promise<{ entry: string; file: string }[]> {
    const entries: { entry: string; file: string }[] = []
    for (const subpath of ['.', './server', './test'])
        entries.push({
            entry: `@abide/abide${subpath.slice(1)}`,
            file: `${PACKAGES}abide/${(await packageOf('abide')).exports[subpath]}`,
        })
    for (const [subpath, file] of Object.entries(
        (await packageOf('harness')).exports,
    ))
        if (subpath !== './package.json')
            entries.push({
                entry: `@abide/harness${subpath.slice(1)}`,
                file: `${PACKAGES}harness/${file}`,
            })
    return entries
}

function packageOf(name: string): Promise<{
    exports: Record<string, string>
    imports?: Record<string, string>
}> {
    return Bun.file(`${PACKAGES}${name}/package.json`).json()
}

/** A specifier a barrel re-exports from, as the file it lands on, or `undefined` off the package. */
async function resolvedFrom(
    file: string,
    specifier: string,
): Promise<string | undefined> {
    if (specifier.startsWith('.'))
        return new URL(specifier, `file://${file}`).pathname
    if (specifier.startsWith('#')) {
        const root = file.slice(0, file.indexOf('/src/'))
        const imports =
            (await Bun.file(`${root}/package.json`).json()).imports ?? {}
        const target = imports[specifier]
        return typeof target === 'string'
            ? `${root}/${target.slice(2)}`
            : undefined
    }
    return undefined
}

/** The names a barrel exports, and whether each is a type alone — following `export *`, and an
 * `export * as` as the one name. */
async function exportsOf(file: string): Promise<Map<string, boolean>> {
    const names = new Map<string, boolean>()
    const source = (await Bun.file(file).text()).replace(/\/\/[^\n]*/g, '')
    for (const [, star] of source.matchAll(/export \* from '([^']+)'/g)) {
        const target = await resolvedFrom(file, star as string)
        if (target)
            for (const [name, typeOnly] of await exportsOf(target))
                names.set(name, typeOnly)
    }
    // A namespace re-export is one value, named where it is spelled.
    for (const [, name] of source.matchAll(/export \* as (\w+) from '[^']+'/g))
        names.set(name as string, false)
    for (const [, allTypes, list, from] of source.matchAll(
        /export (type )?\{([^}]*)\}(?: from '([^']+)')?/g,
    )) {
        // A name re-exported from another public entry point is that entry's, not a second export.
        if (from?.startsWith('@abide/')) continue
        for (const part of (list as string).split(',')) {
            const spelled = part.trim()
            if (spelled === '') continue
            const typeOnly =
                allTypes !== undefined || spelled.startsWith('type ')
            const name = spelled
                .replace(/^type /, '')
                .split(/\s+as\s+/)
                .at(-1) as string
            names.set(name, typeOnly)
        }
    }
    for (const [, kind, name] of source.matchAll(
        /export (?:declare )?(?:async )?(function\*?|const|let|class|type|interface|enum) (\w+)/g,
    ))
        names.set(name as string, kind === 'type' || kind === 'interface')
    return names
}

/** Every name the entry points export, once per scope — a name two abide entries export is the first's. */
export async function declaredExports(): Promise<
    { entry: string; scope: string; name: string; typeOnly: boolean }[]
> {
    const declared: {
        entry: string
        scope: string
        name: string
        typeOnly: boolean
    }[] = []
    const filed = new Set<string>()
    for (const { entry, file } of await entryPoints())
        for (const [name, typeOnly] of await exportsOf(file)) {
            const scope = scopeOf(entry)
            if (filed.has(`${scope}\0${name}`)) continue
            filed.add(`${scope}\0${name}`)
            declared.push({ entry, scope, name, typeOnly })
        }
    return declared
}
