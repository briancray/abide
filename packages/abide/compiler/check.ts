// Type-checking a `.abide` file, by handing the real checker something it already understands.
//
// The template's expressions are TypeScript, so the only honest way to check them is with the
// TypeScript checker — not a bespoke one that agrees with it until it doesn't. So each `.abide` file
// is emitted twice: once as the module it compiles to, and once as a `.d.abide.ts` beside it, which
// is the file `allowArbitraryExtensions` makes `tsc` look for when it resolves `./app.abide`. The
// checker then sees real exports with real types, and a wrong expression inside a template is an
// ordinary type error.
//
// What the checker CANNOT know is that the file it is reading was generated, so `check` runs it and
// moves every diagnostic back onto the `.abide` line through the source map. Everything generated is
// gitignored — the `.abide` file is the source.
//
// It is written into `.abide/types/`, mirroring each file's path from the project root, rather than
// beside the source it came from. `allowArbitraryExtensions` resolves `./page.abide` to a
// `page.d.abide.ts` in the SAME directory and there is no way to redirect that — but `rootDirs` makes
// two directories one VIRTUAL directory for relative resolution, so `[".", "./.abide/types"]` puts
// the declaration where the checker looks without putting it where the author looks. The mirror
// preserves the whole relative path for the same reason it has to work in both directions: a compiled
// module keeps the imports its `<script module>` wrote, so `../models.ts` has to resolve back out into
// the source tree, and it only does when the two trees line up segment for segment.
//
// The root is the PROJECT and not the repository, and that is the part `rootDirs` cannot help with: a
// `<script module>` writes `import { state } from 'abide'`, which is a bare specifier resolved by
// walking up for a `node_modules`, and `rootDirs` governs relative imports only. A mirror rooted
// above the package would walk up from a directory the package's own dependencies are not under and
// find nothing. So the generated tree hangs off the same directory the source's own resolution starts
// from, and a workspace link resolves identically from both.
//
// Three generated files per source, in a tree the author never opens, is also three fewer things
// every scan in this repo has to learn to skip.

// `node:path` stands in for nothing: Bun ships no path api, and the builtin IS the supported one.
import { dirname, relative, resolve } from 'node:path'
import { compile, describe, generatedPosition, originalPosition, type Segment } from './index.ts'
import { configAbove } from './internal/project.ts'

export interface EmitResult {
    source: string
    module: string
    declaration: string
    segments: Segment[]
}

/** Where the generated tree lives, relative to the project root. Under `.abide/`, already ignored. */
export const TYPES_DIR = '.abide/types'

/**
 * Nearest `package.json` directory to nearest `package.json` directory. Walked once per directory.
 *
 * The in-flight WALK rather than its answer, because `emitAll` starts every file before any of them
 * resolves: a map filled after the `await` is a map every concurrent caller has already missed, and
 * the walk then runs once per FILE — which is what this is here to stop.
 */
const PROJECTS = new Map<string, Promise<string>>()

/**
 * The package `from` sits in — where its mirror hangs, and where its bare specifiers resolve from.
 *
 * Derived from the TREE rather than taken from the caller, because a `tsconfig` has to name the
 * mirror in `rootDirs` and a config cannot name a directory that moves with the cwd somebody ran
 * `abide check` in. A `package.json` is the same boundary the module resolver stops at, so this is
 * that rule read rather than a rule invented for the mirror.
 *
 * NOT the same climb as `#server/app.ts`'s, and the difference is deliberate: that one wants the
 * nearest manifest that NAMES something, so a nameless `{ "private": true }` leaf keeps it climbing
 * to the workspace root. This wants the nearest package BOUNDARY, whatever it says, because that is
 * where `rootDirs` and bare-specifier resolution start. Aligning them would break whichever was
 * changed.
 */
function projectOf(from: string): Promise<string> {
    const held = PROJECTS.get(from)
    if (held !== undefined) return held

    const walking = walkToPackage(from)
    PROJECTS.set(from, walking)
    return walking
}

async function walkToPackage(from: string): Promise<string> {
    let at = from
    for (;;) {
        if (await Bun.file(`${at}/package.json`).exists()) break
        const above = dirname(at)
        // A tree with no `package.json` above it at all: the file's own directory, which is the only
        // answer that still lines the two trees up for a `rootDirs` somebody writes by hand.
        if (above === at) return from
        at = above
    }
    return at
}

/**
 * Where a source's mirror entries go, and what the module's banner says.
 *
 * The mirror preserves the path from the package root, so `pages/page.abide` becomes
 * `.abide/types/pages/page.abide.ts` — which is what lets one `rootDirs` pair cover every file in the
 * package, and what makes a compiled module's own `../models.ts` land back on the real one.
 *
 * Its own function because two lanes emit now, and the rule that a mirror entry is only ever swept
 * by the path it was written to means the two must derive that path identically.
 */
async function mirrorFor(path: string): Promise<{ module: string; declaration: string; base: string }> {
    // A path this cannot mirror is refused HERE rather than by each caller. `sourceOf` below maps a
    // mirror entry back to its source and only recognises what this wrote, so a `foo.ts.ts` emitted
    // by a caller that forgot to check is one `pruneOrphans` can never remove.
    if (!path.endsWith('.abide')) throw new Error(`abide: ${path} is not a \`.abide\` file`)
    const root = await projectOf(dirname(resolve(path)))
    const mirrored = `${root}/${TYPES_DIR}/${relative(root, resolve(path))}`
    const module = `${mirrored}.ts`
    return {
        module,
        declaration: mirrored.replace(/\.abide$/, '.d.abide.ts'),
        base: module.split('/').pop() as string,
    }
}

/** The module's text as it is WRITTEN — the banner counted by `HEADER_LINES`, then the emit. */
function moduleText(code: string, base: string): string {
    return (
        `// Generated from ${base.replace(/\.ts$/, '')}. Do not edit.\n${code}` +
        `//# sourceMappingURL=${base}.map\n`
    )
}

/** Compile one file and write the module, its declaration and its map into its package's mirror. */
export async function emitFor(path: string): Promise<EmitResult> {
    // Independent — the read does not wait on the climb, and `emitAll` starts every file at once.
    const [source, where] = await Promise.all([Bun.file(path).text(), mirrorFor(path)])
    let compiled: ReturnType<typeof compile>
    try {
        compiled = compile(source, { filename: path })
    } catch (error) {
        throw new Error(describe(source, path, error))
    }
    // Three unrelated files, so they go out together.
    await Promise.all([
        Bun.write(where.module, moduleText(compiled.code, where.base)),
        Bun.write(`${where.module}.map`, compiled.map),
        Bun.write(
            where.declaration,
            `// Generated. The file \`allowArbitraryExtensions\` resolves \`./${where.base.replace(/\.abide\.ts$/, '.abide')}\` to.\n` +
                `export * from './${where.base}'\n` +
                `export { default } from './${where.base}'\n`,
        ),
    ])
    return {
        source: path,
        module: where.module,
        declaration: where.declaration,
        segments: compiled.segments,
    }
}

/**
 * The MODULE alone, compiled from text the caller already holds.
 *
 * The language server's emit, and only its: an editor's buffer is what the author is looking at, so
 * the bytes on disk are one save behind it and a checker reading them is confidently answering about
 * the previous version. It runs per settled keystroke, which is why it is not `emitFor` with a flag —
 * the map is a full VLQ encode of every segment behind a lazy getter, and the declaration is derived
 * from the filename alone, so both would be rebuilt on every keystroke for a lane that reads neither.
 * The declaration this lane skips is the one resolving THIS file's specifier, which only another file
 * imports — and this lane reports on no other file.
 */
export async function emitModule(path: string, text: string): Promise<EmitResult> {
    const where = await mirrorFor(path)
    let compiled: ReturnType<typeof compile>
    try {
        compiled = compile(text, { filename: path })
    } catch (error) {
        throw new Error(describe(text, path, error))
    }
    await Bun.write(where.module, moduleText(compiled.code, where.base))
    return {
        source: path,
        module: where.module,
        declaration: where.declaration,
        segments: compiled.segments,
    }
}

/**
 * The generated paths a mirror entry can be, mapped back to the source they were emitted from.
 *
 * `null` for anything else in the tree, which is left alone: the mirror is only allowed to delete
 * what it wrote. Maps are not here because the scan below is `**\/*.ts` and never offers one — they
 * are deleted alongside the module they are named off.
 */
function sourceOf(mirrored: string): string | null {
    if (mirrored.endsWith('.d.abide.ts')) return `${mirrored.slice(0, -'.d.abide.ts'.length)}.abide`
    if (mirrored.endsWith('.abide.ts')) return mirrored.slice(0, -'.ts'.length)
    return null
}

/**
 * Delete mirror entries whose `.abide` source is gone.
 *
 * Nothing used to, and the mirror is what `allowArbitraryExtensions` resolves against — so a deleted
 * or MOVED `.abide` left a declaration behind that went on answering `import './x.abide'` forever.
 * That makes the gate pass on a program that does not exist, and it passes only HERE: the mirror is
 * gitignored, so a fresh clone regenerates it from the sources that remain and fails on the same
 * import. A stale artifact making the checker agree is the one failure the checker cannot report,
 * and the tell is a typecheck that is green locally and red on a machine that has never run it.
 *
 * Keyed on the SOURCE existing rather than on what this run emitted, which is what makes it safe for
 * a partial root: `abide check packages/dogfood/pages` leaves the `demos/` mirror alone because those
 * sources are still there, and removes an orphan wherever it finds one.
 */
async function pruneOrphans(packages: Iterable<string>): Promise<void> {
    const removing: Promise<void>[] = []
    for (const root of packages) {
        const mirror = `${root}/${TYPES_DIR}`
        // A package whose mirror has never been written has nothing to sweep, and scanning a
        // directory that is not there throws rather than yielding nothing. `stat` and not `exists`:
        // `Bun.file(dir).exists()` is FALSE for a directory, so the obvious spelling reads as "no
        // mirror" every time and turns the whole sweep off with every test still green.
        try {
            await Bun.file(mirror).stat()
        } catch {
            continue
        }
        // One `exists` per SOURCE rather than per mirror entry. A source has both a module and a
        // declaration in here and `sourceOf` maps them to the same path, so asking per entry stat'd
        // every `.abide` in the tree twice.
        const present = new Map<string, Promise<boolean>>()
        const glob = new Bun.Glob('**/*.ts')
        for await (const found of glob.scan({ cwd: mirror, absolute: false })) {
            const source = sourceOf(found)
            if (source === null) continue
            let asked = present.get(source)
            if (asked === undefined) {
                asked = Bun.file(`${root}/${source}`).exists()
                present.set(source, asked)
            }
            const exists = asked
            removing.push(
                (async () => {
                    if (await exists) return
                    await Bun.file(`${mirror}/${found}`).delete()
                    // The map is named off the MODULE, which shares the source and therefore the
                    // answer. The declaration has none, and asking would be a stat per orphan.
                    if (found.endsWith('.d.abide.ts')) return
                    const map = Bun.file(`${mirror}/${found}.map`)
                    if (await map.exists()) await map.delete()
                })(),
            )
        }
    }
    await Promise.all(removing)
}

/**
 * One `tsc` project per root, deduped — and `null` for a root with no config above it at all.
 *
 * A set because `abide check packages/dogfood/pages packages/dogfood/site` names one project twice,
 * and running the checker over it twice is the whole check paid for again.
 */
async function projectsOf(roots: string[]): Promise<(string | null)[]> {
    const climbing: Promise<string | null>[] = []
    for (const root of roots) climbing.push(configAbove(resolve(root)))
    return [...new Set(await Promise.all(climbing))]
}

export async function emitAll(roots: string[]): Promise<EmitResult[]> {
    // Files are independent, so the scan only collects paths and the compiles run together — this is
    // on the `typecheck` path a developer waits on.
    const pending: Promise<EmitResult>[] = []
    // Where each root's mirror hangs. The same memoised walk `emitFor` makes per file — a root with
    // no `.abide` under it at all still has a mirror to sweep, which is exactly the case emitting
    // alone can never reach. Not awaited in the loop: the climb has no bearing on the next scan.
    const climbing: Promise<string>[] = []
    for (const root of roots) {
        climbing.push(projectOf(resolve(root)))
        const glob = new Bun.Glob('**/*.abide')
        for await (const path of glob.scan({ cwd: root, absolute: true })) pending.push(emitFor(path))
    }
    const [written, climbed] = await Promise.all([Promise.all(pending), Promise.all(climbing)])
    // A SET, because two roots inside one package share one mirror and sweeping it twice races two
    // deletes onto the same orphan.
    const packages = new Set(climbed)
    // AFTER the emit, not beside it. The two touch disjoint sets — one writes where a source exists,
    // the other deletes where one does not — but the mirror is created BY the emit, so a concurrent
    // sweep of a package being written for the first time scans a directory that is not there yet.
    await pruneOrphans(packages)
    return written
}

// `file(line,col): error TSxxxx: message` — tsc's one-line form, which is what `--pretty false` gives.
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): (.+)$/

/** How many lines `moduleText` writes above the emit. Private: both readers are in this file. */
const HEADER_LINES = 1

/**
 * A place in a WRITTEN module as the place in the `.abide` it came from. Zero-based in, one-based out.
 *
 * The one reader of the banner's line count, which is a fact about `moduleText` above and nothing
 * else: the map was built before that line existed, so it is counted off before the mapping is asked.
 * Exported so the live lane asks this rather than redoing the arithmetic in another package — a
 * two-line banner would otherwise fix `abide check` here and silently move every editor squiggle up
 * a line, with nothing red.
 */
export function placeIn(
    segments: Segment[],
    line: number,
    column: number,
): { line: number; column: number } | null {
    return originalPosition(segments, line - HEADER_LINES, column)
}

/**
 * The inverse: a place on the `.abide` line as the place in the WRITTEN module. Zero-based both ways.
 *
 * `placeIn`'s mirror, and here for the same reason it is: the banner is a fact about `moduleText`
 * above, so the two directions have to count it off the same way or a hover asks about the line below
 * the one the cursor is on. Both readers of `HEADER_LINES` are now in this file, which is what stops
 * a two-line banner from being a fix in one lane and a silent off-by-one in the other.
 */
export function positionIn(
    segments: Segment[],
    line: number,
    column: number,
): { line: number; column: number } | null {
    const found = generatedPosition(segments, line, column)
    return found === null ? null : { line: found.line + HEADER_LINES, column: found.column }
}

/**
 * The `.abide` FILE a generated module was emitted from — the real one, outside the mirror.
 *
 * For the definition lane, which is the one caller that gets a path back from the checker rather than
 * handing one to it: resolving `<Card>` lands in `<root>/.abide/types/ui/Card.abide.ts`, and sending
 * an author to a generated file is worse than not answering. `sourceOf` above is the same question
 * asked by the SWEEP, and it deliberately stops short of this — it decides whether the mirror wrote a
 * path, so it stays inside the mirror. This has to come back OUT of it, which is the `TYPES_DIR`
 * segment removed rather than a suffix trimmed.
 */
export function sourceFor(mirrored: string): string | null {
    const marker = `/${TYPES_DIR}/`
    const at = mirrored.indexOf(marker)
    if (at === -1) return null
    const inside = sourceOf(mirrored.slice(at + marker.length))
    return inside === null ? null : `${mirrored.slice(0, at)}/${inside}`
}

/**
 * Move a diagnostic in a generated module back onto the `.abide` line it came from.
 *
 * The string face of `placeIn`: `tsc` reports 1-based lines in the file it read, and this is the lane
 * that has to read them back out of a line of text.
 */
export function remap(line: string, byModule: Map<string, EmitResult>): string {
    const match = DIAGNOSTIC.exec(line)
    if (match === null) return line
    const [, file, row, column, rest] = match as unknown as [string, string, string, string, string]
    const emitted = byModule.get(file)
    if (emitted === undefined) return line

    const position = placeIn(emitted.segments, Number(row) - 1, Number(column) - 1)
    if (position === null) return `${emitted.source}(${row},${column}): ${rest}   [generated]`
    return `${emitted.source}(${position.line},${position.column}): ${rest}`
}

/**
 * Emit every `.abide` under `roots`, run the real checker over each PACKAGE they sit in, and hand
 * back what it said — every diagnostic already moved back onto the `.abide` line it came from.
 *
 * One checker run per root, against the nearest `tsconfig.json` ABOVE it, rather than one run over
 * whatever config the working directory happened to sit under. That is what makes naming a package
 * check that package: the old shape ran a config found at the cwd, so `abide check <pkg>` from a
 * repo root ran the ROOT config, and a package that config did not `include` was checked to zero
 * files and reported clean.
 *
 * Concurrently, because the packages are independent and this is the gate a developer waits on.
 *
 * A LIST rather than a printed report and an exit code: what to print and what to exit with is the
 * caller's, and `abide check` is the caller. Empty means clean, which is the whole of the decision.
 */
export async function diagnose(roots: string[]): Promise<string[]> {
    const asked = roots.length > 0 ? roots : ['.']
    const written = await emitAll(asked)

    const byModule = new Map<string, EmitResult>()
    for (const item of written) {
        byModule.set(item.module, item)
        // tsc reports whatever path form it was given; both are matched so neither has to be guessed.
        // `relative` and not a prefix strip, because the mirror hangs off the PACKAGE and the checker
        // may be run from a directory inside it — then the path back out starts with `../`, which a
        // strip leaves absolute and every diagnostic silently stops being moved onto its `.abide`.
        byModule.set(relative(process.cwd(), item.module), item)
    }

    const found: string[] = []
    const running: Promise<string>[] = []
    for (const project of await projectsOf(asked)) {
        if (project === null) {
            // Reported rather than silently skipped: a checker with no program to run is the failure
            // this whole shape exists to make loud, and "clean" is what it used to look like.
            found.push('abide check: no tsconfig.json at or above the directory named')
            continue
        }
        const tsc = Bun.spawn(['bunx', 'tsc', '-p', project, '--noEmit', '--pretty', 'false'], {
            // The working directory the CALLER is in, so every diagnostic is reported relative to the
            // same place whichever package it came from — which is what `byModule` is keyed on above.
            cwd: process.cwd(),
            stdout: 'pipe',
            stderr: 'pipe',
        })
        running.push(
            (async () =>
                `${await new Response(tsc.stdout).text()}${await new Response(tsc.stderr).text()}`)(),
        )
    }

    for (const output of await Promise.all(running)) {
        for (const line of output.split('\n')) {
            if (line.trim() === '') continue
            found.push(remap(line, byModule))
        }
    }
    return found
}

// The EMIT on its own, which is the one thing `abide check` is not: it writes the generated modules
// and says where they went, without a checker. `abide check` is the checking front door.
if (import.meta.main) {
    const roots = Bun.argv.slice(2).filter((argument) => !argument.startsWith('-'))
    const written = await emitAll(roots.length > 0 ? roots : ['.'])
    for (const item of written) console.log(item.module)
}
