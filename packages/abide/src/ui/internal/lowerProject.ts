// LOWER A PROJECT'S `.abide` FILES FOR THE TYPE ENGINE — the one loop, for both commands that run it.
//
// `abide check` and `abide lsp` must agree about what a project's types ARE: the editor going green on
// a file CI rejects (or the reverse) is the worst version of a two-lane compiler, because check is what
// runs on every keystroke. They were kept in agreement by hand, as two copies of the same sequence —
// `findAbideFiles` → `parse` → `validateTemplate` → `componentDts` → `emitCheck` → virtual files —
// split across a RUNTIME boundary, since `check` runs under Bun and `lsp` is re-executed by node.
//
// The copies differed in exactly three things, all of which are parameters rather than reasons to fork:
//
//   • how a source is READ — `Bun.file().text()` vs an overlay-aware `readFileSync` (an LSP serves
//     unsaved editor buffers, so its reader consults open documents first);
//   • the virtual TS path SCHEME — `__abide_check_<name>_<hash>` vs `__abide_lsp_<name>`;
//   • where a failure GOES — a diagnostic list vs a per-file parse-error map.
//
// So this module takes a reader and a path scheme and answers a uniform result, and each caller
// projects that into its own shape. Nothing here touches the filesystem or names a runtime: the
// Bun-only pieces (`Bun.file`, `Bun.hash`) stay in `check.ts` where only Bun ever reaches them, which
// is what stops "does this run under node" from being a code-organization question.

import { componentDts, emitCheck, type Segment } from './emitCheck.ts'
import { parse } from './parse.ts'
import { validateTemplate } from './validateTemplate.ts'

// A script-bearing `.abide` and the virtual TS module it lowered to. `segments` maps positions back.
export interface LoweredModule {
    abidePath: string
    tsPath: string
    source: string
    code: string
    segments: Segment[]
}

// A file that could not be lowered — a parse error, or a template the BUILD lane would reject. Both
// are reported at a position rather than thrown, because one bad file must not blank the project.
export interface LoweringFailure {
    abidePath: string
    line: number
    column: number
    message: string
}

export interface Lowering {
    // Virtual files served to the type engine through an `fs` overlay — NO disk writes. Each `.abide`
    // gets its typed `<file>.abide.d.ts` companion (so a verbatim `import X from "./X.abide"` resolves
    // to that companion's typed default rather than the ambient `declare module "*.abide"` any), and
    // each script-bearing one gets its generated module.
    files: Record<string, string>
    modules: LoweredModule[]
    failures: LoweringFailure[]
}

export interface LowerOptions {
    abideFiles: readonly string[]
    // The source of one `.abide`, or `undefined` to skip it (unreadable, or deleted under us).
    readSource: (abidePath: string) => string | undefined
    // The virtual TS path a lowered module is served at. Must be a sibling of its `.abide` so relative
    // imports resolve identically.
    tsPathFor: (abidePath: string) => string
}

export function lowerProject(options: LowerOptions): Lowering {
    const files: Record<string, string> = {}
    const modules: LoweredModule[] = []
    const failures: LoweringFailure[] = []

    for (const abidePath of options.abideFiles) {
        const source = options.readSource(abidePath)
        if (source === undefined) continue

        let root: ReturnType<typeof parse>
        try {
            root = parse(source, { filename: abidePath })
        } catch (parseError) {
            // A parse failure is itself a check failure — surface it at the reported position if the
            // parser gave one.
            const position = parseError as { line?: number; column?: number }
            failures.push({
                abidePath,
                line: position.line ?? 1,
                column: position.column ?? 1,
                message: parseError instanceof Error ? parseError.message : String(parseError),
            })
            continue
        }

        // The BUILD lane's structural gates, asked here so the check lane rejects exactly what
        // `abide build` rejects. Without this the check lane ran off `parse` alone and was silent on
        // four constructs the build hard-throws on — a green check followed by a failing build.
        const verdict = validateTemplate(root)
        if (!verdict.legal) {
            failures.push({ abidePath, line: 1, column: 1, message: verdict.rejected })
            continue
        }

        files[`${abidePath}.d.ts`] = componentDts(source, root, verdict.analysis)
        // A script-less `.abide` still gets a companion (it can still be imported and invoked) but has
        // nothing to type-check.
        if (root.moduleScript === null && root.instanceScript === null) continue

        const { code, segments } = emitCheck(source, root)
        const tsPath = options.tsPathFor(abidePath)
        files[tsPath] = code
        modules.push({ abidePath, tsPath, source, code, segments })
    }

    return { files, modules, failures }
}
