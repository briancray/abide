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
import { compile, describe, originalPosition, type Segment } from './index.ts'

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
 * The package `path` belongs to — where its mirror hangs, and where its bare specifiers resolve from.
 *
 * Derived from the FILE rather than taken from the caller, because a `tsconfig` has to name the
 * mirror in `rootDirs` and a config cannot name a directory that moves with the cwd somebody ran
 * `abide check` in. A `package.json` is the same boundary the module resolver stops at, so this is
 * that rule read rather than a rule invented for the mirror.
 *
 * NOT the same climb as `$server/app.ts`'s, and the difference is deliberate: that one wants the
 * nearest manifest that NAMES something, so a nameless `{ "private": true }` leaf keeps it climbing
 * to the workspace root. This wants the nearest package BOUNDARY, whatever it says, because that is
 * where `rootDirs` and bare-specifier resolution start. Aligning them would break whichever was
 * changed.
 */
function projectOf(path: string): Promise<string> {
    const from = dirname(resolve(path))
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
 * Compile one file and write the module, its declaration and its map into its package's mirror.
 *
 * The mirror preserves the path from the package root, so `pages/page.abide` becomes
 * `.abide/types/pages/page.abide.ts` — which is what lets one `rootDirs` pair cover every file in the
 * package, and what makes a compiled module's own `../models.ts` land back on the real one.
 */
export async function emitFor(path: string): Promise<EmitResult> {
    const source = await Bun.file(path).text()
    const root = await projectOf(path)
    const mirrored = `${root}/${TYPES_DIR}/${relative(root, resolve(path))}`
    const modulePath = `${mirrored}.ts`
    const declarationPath = mirrored.replace(/\.abide$/, '.d.abide.ts')
    let compiled: ReturnType<typeof compile>
    try {
        compiled = compile(source, { filename: path })
    } catch (error) {
        throw new Error(describe(source, path, error))
    }
    const base = modulePath.split('/').pop() as string
    // Three unrelated files, so they go out together.
    await Promise.all([
        Bun.write(
            modulePath,
            `// Generated from ${base.replace(/\.ts$/, '')}. Do not edit.\n${compiled.code}` +
                `//# sourceMappingURL=${base}.map\n`,
        ),
        Bun.write(`${modulePath}.map`, compiled.map),
        Bun.write(
            declarationPath,
            `// Generated. The file \`allowArbitraryExtensions\` resolves \`./${base.replace(/\.abide\.ts$/, '.abide')}\` to.\n` +
                `export * from './${base}'\n` +
                `export { default } from './${base}'\n`,
        ),
    ])
    return { source: path, module: modulePath, declaration: declarationPath, segments: compiled.segments }
}

export async function emitAll(roots: string[]): Promise<EmitResult[]> {
    // Files are independent, so the scan only collects paths and the compiles run together — this is
    // on the `typecheck` path a developer waits on.
    const pending: Promise<EmitResult>[] = []
    for (const root of roots) {
        const glob = new Bun.Glob('**/*.abide')
        for await (const path of glob.scan({ cwd: root, absolute: true })) pending.push(emitFor(path))
    }
    return Promise.all(pending)
}

// `file(line,col): error TSxxxx: message` — tsc's one-line form, which is what `--pretty false` gives.
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): (.+)$/

/**
 * Move a diagnostic in a generated module back onto the `.abide` line it came from.
 *
 * The header line the emitter writes is counted off first: `tsc` reports 1-based lines in the file it
 * read, and the map was built before that line existed.
 */
export function remap(line: string, byModule: Map<string, EmitResult>): string {
    const match = DIAGNOSTIC.exec(line)
    if (match === null) return line
    const [, file, row, column, rest] = match as unknown as [string, string, string, string, string]
    const emitted = byModule.get(file)
    if (emitted === undefined) return line

    const HEADER_LINES = 1
    const position = originalPosition(emitted.segments, Number(row) - 1 - HEADER_LINES, Number(column) - 1)
    if (position === null) return `${emitted.source}(${row},${column}): ${rest}   [generated]`
    return `${emitted.source}(${position.line},${position.column}): ${rest}`
}

/**
 * Emit every `.abide` under `roots`, run the real checker over the project, and hand back what it
 * said — every diagnostic already moved back onto the `.abide` line it came from.
 *
 * A LIST rather than a printed report and an exit code: what to print and what to exit with is the
 * caller's, and `abide check` is the caller. Empty means clean, which is the whole of the decision.
 */
export async function diagnose(roots: string[]): Promise<string[]> {
    const written = await emitAll(roots.length > 0 ? roots : ['.'])

    const byModule = new Map<string, EmitResult>()
    for (const item of written) {
        byModule.set(item.module, item)
        // tsc reports whatever path form it was given; both are matched so neither has to be guessed.
        // `relative` and not a prefix strip, because the mirror hangs off the PACKAGE and the checker
        // may be run from a directory inside it — then the path back out starts with `../`, which a
        // strip leaves absolute and every diagnostic silently stops being moved onto its `.abide`.
        byModule.set(relative(process.cwd(), item.module), item)
    }

    const tsc = Bun.spawnSync(['bunx', 'tsc', '--noEmit', '--pretty', 'false'], {
        cwd: process.cwd(),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const output = `${tsc.stdout.toString()}${tsc.stderr.toString()}`
    const found: string[] = []
    for (const line of output.split('\n')) {
        if (line.trim() === '') continue
        found.push(remap(line, byModule))
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
