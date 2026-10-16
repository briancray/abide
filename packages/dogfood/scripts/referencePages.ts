// THE REFERENCE'S PAGES, generated (40.42): one per export a public entry point declares and
// REGISTRY names, and one per REGISTRY `#` group holding rows no export claims (40.44). Which row is on
// which page is `src/lib/referenceOf.ts`'s, and is written down there.
//
// Writes `src/lib/REFERENCE.ts`, the list `SECTIONS` and the reference nav read, and a file per page
// that renders it — and deletes a page that is no longer one. `coverage.test.ts` runs this and
// fails where what is on disk differs, so a REGISTRY edit that adds or moves a page fails the gate
// until this is run:
//
//     bun packages/dogfood/scripts/referencePages.ts

import { slugify } from '../src/lib/inline.ts'
import {
    placementsOf,
    type ReferencePage,
    referenceFileOf,
    registryRows,
    scopeOf,
} from '../src/lib/referenceOf.ts'

const PACKAGES = new URL('../../', import.meta.url).pathname
const DOGFOOD = new URL('../', import.meta.url).pathname
const REGISTRY = new URL('../../../docs/REGISTRY.md', import.meta.url)

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

/** The names a barrel exports, and whether each is a type alone — following `export *`. */
async function exportsOf(file: string): Promise<Map<string, boolean>> {
    const names = new Map<string, boolean>()
    const source = (await Bun.file(file).text()).replace(/\/\/[^\n]*/g, '')
    for (const [, star] of source.matchAll(/export \* from '([^']+)'/g)) {
        const target = await resolvedFrom(file, star as string)
        if (target)
            for (const [name, typeOnly] of await exportsOf(target))
                names.set(name, typeOnly)
    }
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

/** Every page the reference has, in reading order, and each page's file. */
export async function referencePages(): Promise<{
    pages: ReferencePage[]
    leaf: string
    files: Map<string, string>
}> {
    const declared = await declaredExports()
    const rows = registryRows(await Bun.file(REGISTRY).text())
    const { placements, aliases } = placementsOf(rows, declared)

    const byKey = new Map<string, ReferencePage>()
    const order: ReferencePage[] = []
    for (const [at, placement] of placements.entries()) {
        const row = rows[at]
        if (row === undefined) continue
        const key =
            placement.kind === 'group'
                ? `group\0${placement.group}`
                : `${placement.scope}\0${placement.name}`
        if (byKey.has(key)) continue
        let page: ReferencePage
        if (placement.kind === 'group')
            page = {
                route: `/reference/${slugify(placement.group)}`,
                names: [],
                entry: undefined,
                group: placement.group,
                typeOnly: false,
            }
        else {
            const own = declared.find(
                (one) =>
                    one.scope === placement.scope &&
                    one.name === placement.name,
            )
            if (own === undefined)
                throw new Error(`reference: ${placement.name} is not exported`)
            const names = [placement.name]
            for (const [alias, to] of aliases)
                if (
                    to === placement.name &&
                    alias.startsWith(`${placement.scope}\0`)
                )
                    names.push(alias.slice(placement.scope.length + 1))
            // A type, and a class an app writes as one, are filed apart from the values — so
            // `Reactive` and `reactive` are two addresses on a disk that folds case.
            const signature = rows.find(
                (one) =>
                    one.cells[0] === `\`${own.name}\`` ||
                    one.cells[0]?.startsWith(`\`${own.name}<`),
            )?.cells[1]
            const typed =
                own.typeOnly || signature?.startsWith('`class ') === true
            const base =
                own.scope === 'abide'
                    ? '/reference'
                    : `/reference/harness-${own.entry.slice('@abide/harness/'.length).replaceAll('/', '-')}`
            page = {
                route: `${base}${typed ? '/types' : ''}/${placement.name}`,
                names,
                entry: own.entry,
                group: row.group,
                typeOnly: own.typeOnly,
            }
        }
        byKey.set(key, page)
        order.push(page)
    }
    // Reading order: REGISTRY's groups in turn, each page where its first row is.
    const groups: string[] = []
    for (const page of order)
        if (!groups.includes(page.group)) groups.push(page.group)
    const pages: ReferencePage[] = []
    for (const group of groups)
        for (const page of order) if (page.group === group) pages.push(page)

    const folded = new Map<string, string>()
    for (const page of pages) {
        const other = folded.get(page.route.toLowerCase())
        if (other)
            throw new Error(
                `reference: ${page.route} and ${other} differ only in case`,
            )
        folded.set(page.route.toLowerCase(), page.route)
    }

    let leaf = `// GENERATED by scripts/referencePages.ts from docs/REGISTRY.md and the entry points' exports (40.42).
// Every reference page in reading order, which \`SECTIONS\` and the reference nav list. Run the script; do
// not edit this.

export const REFERENCE: readonly {
    route: string
    names: readonly string[]
    entry: string | undefined
    group: string
    typeOnly: boolean
}[] = [\n`
    const quoted = (text: string): string => `'${text.replaceAll("'", "\\'")}'`
    for (const page of pages)
        leaf += `    {
        route: ${quoted(page.route)},
        names: [${page.names.map(quoted).join(', ')}],
        entry: ${page.entry === undefined ? 'undefined' : quoted(page.entry)},
        group: ${quoted(page.group)},
        typeOnly: ${page.typeOnly},
    },\n`
    leaf += ']\n'

    const files = new Map<string, string>()
    for (const page of pages)
        files.set(
            referenceFileOf(page.route),
            `<script>
// GENERATED by scripts/referencePages.ts: this page's rows are REGISTRY's, read as it renders.
import Reference from '#src/reference/lib/Reference.abide'
</script>

<Reference/>
`,
        )
    return { pages, leaf, files }
}

/** The generated pages on disk, from the docs app's root. */
export function generatedOnDisk(): string[] {
    const found: string[] = []
    for (const path of new Bun.Glob('src/reference/**/*.abide').scanSync({
        cwd: DOGFOOD,
    }))
        if (
            path !== 'src/reference/index.abide' &&
            !path.startsWith('src/reference/lib/')
        )
            found.push(path)
    return found.sort()
}

export const LEAF = `${DOGFOOD}src/lib/REFERENCE.ts`

if (import.meta.main) {
    const { leaf, files } = await referencePages()
    await Bun.write(LEAF, leaf)
    for (const path of generatedOnDisk())
        if (!files.has(path)) await Bun.file(`${DOGFOOD}${path}`).delete()
    await Bun.$`find ${`${DOGFOOD}src/reference`} -type d -empty -delete`.quiet()
    for (const [path, source] of files)
        await Bun.write(`${DOGFOOD}${path}`, source)
    console.log(`reference: ${files.size} pages`)
}
