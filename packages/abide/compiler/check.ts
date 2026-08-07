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

import { compile, describe, originalPosition, type Segment } from './index.ts'

export interface EmitResult {
    source: string
    module: string
    declaration: string
    segments: Segment[]
}

/** Compile one file and write the module, its declaration and its map beside it. */
export async function emitFor(path: string): Promise<EmitResult> {
    const source = await Bun.file(path).text()
    const modulePath = `${path}.ts`
    const declarationPath = path.replace(/\.abide$/, '.d.abide.ts')
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
    const found: string[] = []
    for (const root of roots) {
        const glob = new Bun.Glob('**/*.abide')
        for await (const path of glob.scan({ cwd: root, absolute: true })) found.push(path)
    }
    return Promise.all(found.map(emitFor))
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
        byModule.set(item.module.replace(`${process.cwd()}/`, ''), item)
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
