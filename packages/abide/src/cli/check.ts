// `abide check` — best-effort TYPE-CHECK of `.abide` files (spec C10: generate-TS-then-check via TS7).
//
// WHAT IT CHECKS (and what it deliberately does not):
//   For every `.abide` under `dir` we parse it and lower it to a type-only sibling `.ts` module via
//   `emitCheck` (ui/internal/emitCheck.ts): a tiny header, the script IMPORTS verbatim (so unresolved
//   imports are real errors), the script DECLARATIONS/statements, AND the template body as real
//   lexically-scoped TS so TS's own scoping + narrowing flow through it. One rewrite: a top-level
//   `let/const/var x = <init>` becomes `let x = __abideUnwrap(<init>)`. `__abideUnwrap` maps a
//   `State<T>` to its VALUE type `T` (with `__AbideWiden` repairing degenerate empty/nullish inits)
//   and is identity for everything else — mirroring the runtime `$def` accessor, where a `.abide` script
//   reads/writes a state var as its underlying value (`count++`), so a state var must type-check as `T`,
//   not `State<T>`. Without this every use of a cell would be a false positive.
//   The generated module is type-checked with TypeScript 7 (the same `typescript/unstable` sync API
//   `deriveSchema` uses; under Bun that API cannot open its pipe, so — exactly like `deriveSchema` —
//   we bridge through a `node` subprocess running THIS file). Diagnostics are mapped back to the
//   `.abide` source by an offset segment map (best-effort line/column).
//
//   This catches: unresolved imports, undefined identifiers, and type errors in BOTH the script and
//   template expressions — including wrong argument types to imported+typed RPCs called from a template
//   (`{await rpc(args)}`), `{#for}`/`{#await}` bindings, and control-flow narrowing. Cross-file component
//   props are typed via each `.abide`'s `.d.ts` companion. NOT checked: quoted-attribute interpolation
//   (`title="x {n}"`) and nested branch-local `<script>`s — only the top-level module + instance scripts.

import { type Dirent, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FileSystem } from 'typescript/unstable/fs'
import { API, DiagnosticCategory } from 'typescript/unstable/sync'
import {
    indexByGeneratedPath,
    type RawDiagnostic,
    resolveAbidePosition,
} from '../ui/internal/abideDiagnostic.ts'
import { lowerProject } from '../ui/internal/lowerProject.ts'
import { writeHealthCompanion } from './writeHealthCompanion.ts'

// A single mapped diagnostic against a `.abide` file. `line`/`column` are 1-based.
export interface CheckDiagnostic {
    file: string
    line: number
    column: number
    code: number
    message: string
}

export interface CheckResult {
    ok: boolean
    diagnostics: CheckDiagnostic[]
}

// Marker the node subprocess prints so the Bun-side parent finds the JSON result line.
const RESULT_MARKER = '__ABIDE_CHECK_RESULT__:'

// Diagnostic codes suppressed as noise for the extracted-script model: an inline callback in a
// `.abide` script is contextually typed by the template/runtime binding it feeds, and that context is
// gone once the script is lifted into a bare module — so implicit-any on such parameters/bindings is a
// strictness lint, not a correctness error. (C10 best-effort scope.)
// A `.abide` <script> is PLAIN JavaScript (it runs verbatim via `new Function` on the SSR/mount
// path), so rules that can only be satisfied by adding TypeScript syntax — annotations, `as`, `!` —
// are unactionable here and are dropped. Genuine shape/resolution errors (wrong RPC args, unresolved
// imports, undefined identifiers, non-null-safety that control flow can fix) are kept.
// Codes suppressed as noise (shared with the persistent `lsp` engine).
export const SUPPRESSED_CODES = new Set<number>([
    7005, // Variable implicitly has an 'any' type.
    7006, // Parameter implicitly has an 'any' type.
    7031, // Binding element implicitly has an 'any' type.
    7034, // Variable implicitly has type 'any' in some locations.
    18046, // 'x' is of type 'unknown' (e.g. a `catch (e)` binding — cannot be annotated in plain JS).
])

// One raw diagnostic as returned by the TS7 pass (before source mapping).
// The generated TS for one `.abide` file plus everything needed to map its diagnostics back.

// ---------------------------------------------------------------------------
// Top-level entry
// ---------------------------------------------------------------------------

export async function check(dir: string): Promise<CheckResult> {
    // The app's generated type companions come first: a `.abide` that reads `health()` is checked
    // against the same document its editor sees, and a check on a fresh clone (where `src/.abide/` is
    // gitignored and therefore absent) is not a different check from one on a dev machine.
    await writeHealthCompanion(dir)
    // One lowering loop, shared with `abide lsp` (`ui/internal/lowerProject.ts`) so the editor and CI
    // cannot disagree about what a project's types are. The two Bun-only pieces stay HERE, where only
    // Bun reaches them: the file read, and the content-hashed virtual path.
    const lowered = lowerProject({
        abideFiles: findAbideFiles(dir),
        readSource: (abidePath) => {
            try {
                return readFileSync(abidePath, 'utf8')
            } catch {
                return undefined
            }
        },
        tsPathFor: (abidePath) =>
            join(
                dirname(abidePath),
                `__abide_check_${basename(abidePath).replace(/[^\w]/g, '_')}_${Bun.hash(abidePath).toString(36)}.ts`,
            ),
    })
    const toCheck = lowered.modules
    const virtualFiles = lowered.files
    const diagnostics: CheckDiagnostic[] = lowered.failures.map((failure) => ({
        file: failure.abidePath,
        line: failure.line,
        column: failure.column,
        code: 0,
        message: failure.message,
    }))

    const rawDiagnostics =
        toCheck.length > 0
            ? diagnose(dir, { files: virtualFiles, open: toCheck.map((entry) => entry.tsPath) })
            : []

    // Indexing + map-back is `abideDiagnostic`, shared with the LSP. Both traps it handles (tsgo
    // canonicalizing the reported path, a diagnostic landing in the synthetic header) DROP a diagnostic
    // rather than throw, so getting either wrong here means `abide check` reports GREEN on a file with
    // type errors — which is exactly what happened while the two lanes hand-rolled this separately.
    const index = indexByGeneratedPath(toCheck)
    for (const raw of rawDiagnostics) {
        const resolved = resolveAbidePosition(raw, index)
        if (resolved === undefined) continue
        diagnostics.push({
            file: resolved.module.abidePath,
            line: resolved.line,
            column: resolved.column,
            code: raw.code,
            message: raw.text,
        })
    }

    diagnostics.sort((a, b) =>
        a.file === b.file ? a.line - b.line || a.column - b.column : a.file < b.file ? -1 : 1,
    )
    return { ok: diagnostics.length === 0, diagnostics }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

export function findAbideFiles(dir: string): string[] {
    const found: string[] = []
    // Guard against symlink cycles by tracking canonical (realpath) directories already walked.
    const seenDirs = new Set<string>()
    const walk = (current: string): void => {
        let real: string
        try {
            real = realpathSync(current)
        } catch {
            return
        }
        if (seenDirs.has(real)) return
        seenDirs.add(real)
        let entries: Dirent[]
        try {
            entries = readdirSync(current, { withFileTypes: true })
        } catch {
            return
        }
        for (const dirent of entries) {
            const full = join(current, dirent.name)
            // A symlink Dirent reports neither isDirectory() nor isFile() — stat the target so
            // symlinked `.abide` files/dirs (common in monorepos) aren't silently skipped.
            let isDir = dirent.isDirectory()
            let isFile = dirent.isFile()
            if (dirent.isSymbolicLink()) {
                try {
                    const target = statSync(full)
                    isDir = target.isDirectory()
                    isFile = target.isFile()
                } catch {
                    continue // broken symlink
                }
            }
            if (isDir) {
                if (
                    dirent.name === 'node_modules' ||
                    dirent.name === 'dist' ||
                    dirent.name.startsWith('.')
                )
                    continue
                walk(full)
            } else if (isFile && dirent.name.endsWith('.abide')) {
                found.push(full)
            }
        }
    }
    walk(dir)
    found.sort()
    return found
}

// ---------------------------------------------------------------------------
// Generation (parse -> transformed TS + offset segment map)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TS7 diagnostics — the `TypeEngine` seam (Bun -> node bridge, mirrors deriveSchema)
// ---------------------------------------------------------------------------

// One diagnose request: the full set of VIRTUAL files (generated modules + `.abide.d.ts` companions,
// keyed by absolute path) and the subset to actually type-check (`open`). The engine reads virtual
// content through an `fs` overlay and falls back to the real filesystem for everything else.
export interface DiagnoseRequest {
    files: Record<string, string>
    open: string[]
}

// The `fs` overlay handed to the tsgo `API`: serve a virtual file's content / existence, else defer to
// the real filesystem (`undefined`). This is the seam the `lsp` sidecar reuses to serve unsaved editor
// buffers in-memory (PR3). `readFile`/`fileExists`/`realpath` cover module resolution of a virtual
// sibling (`import X from "./X.abide"` → `X.abide.d.ts`); `getAccessibleEntries` MERGES the virtual
// files into their directory's real listing so the tsconfig `include` glob sees them and loads them
// into the CONFIGURED project (with its ambient `declare module "*.css"|"*.abide"`) rather than a bare
// inferred project — otherwise a virtual file's side-effect `import "./x.css"` would fail to resolve.
// `getFiles` is read LIVE on every callback so a persistent engine (the `lsp` sidecar) sees buffer
// edits without rebuilding the `API`.
export function overlayFs(getFiles: () => Record<string, string>): FileSystem {
    return {
        readFile: (name) => {
            const files = getFiles()
            return Object.hasOwn(files, name) ? files[name] : undefined
        },
        fileExists: (name) => (Object.hasOwn(getFiles(), name) ? true : undefined),
        realpath: (path) => (Object.hasOwn(getFiles(), path) ? path : undefined),
        getAccessibleEntries: (directory) => {
            const files = getFiles()
            const virtual: string[] = []
            for (const path of Object.keys(files)) {
                if (dirname(path) === directory) virtual.push(basename(path))
            }
            if (virtual.length === 0) return undefined // no virtual files here → real listing
            const realFiles: string[] = []
            const directories: string[] = []
            try {
                for (const entry of readdirSync(directory, { withFileTypes: true })) {
                    if (entry.isDirectory()) directories.push(entry.name)
                    else realFiles.push(entry.name)
                }
            } catch {
                // directory may not exist on disk (all-virtual) — the virtual entries stand alone
            }
            const merged = new Set(realFiles)
            for (const name of virtual) merged.add(name)
            return { files: [...merged], directories }
        },
    }
}

function diagnose(cwd: string, request: DiagnoseRequest): RawDiagnostic[] {
    const bun = (globalThis as { Bun?: unknown }).Bun
    if (bun !== undefined) return diagnoseViaNodeSubprocess(cwd, request)
    return diagnoseInProcess(cwd, request)
}

function diagnoseViaNodeSubprocess(cwd: string, request: DiagnoseRequest): RawDiagnostic[] {
    const self = fileURLToPath(import.meta.url)
    const spawnSync = (
        globalThis as {
            Bun: {
                spawnSync: (
                    cmd: string[],
                    opts?: unknown,
                ) => {
                    stdout: { toString(): string }
                    stderr: { toString(): string }
                    success: boolean
                }
            }
        }
    ).Bun.spawnSync
    // The virtual-file manifest rides in on STDIN (no temp files); the diagnostics ride out on STDOUT.
    const proc = spawnSync(['node', self, '--abide-diagnose', cwd], {
        stdin: new TextEncoder().encode(JSON.stringify(request)),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const stdout = proc.stdout.toString()
    const markerAt = stdout.lastIndexOf(RESULT_MARKER)
    if (markerAt === -1) {
        const stderr = proc.stderr.toString().trim()
        throw new Error(
            `abide check: type-check subprocess produced no result${stderr ? ` (stderr: ${stderr})` : ''}`,
        )
    }
    const jsonStart = markerAt + RESULT_MARKER.length
    const jsonEnd = stdout.indexOf('\n', jsonStart)
    const json = stdout.slice(jsonStart, jsonEnd === -1 ? undefined : jsonEnd)
    return JSON.parse(json) as RawDiagnostic[]
}

// Runs under node (types stripped by Node >= 23). Uses the sync TS7 API — which cannot open its pipe
// under Bun, hence the subprocess bridge above. Virtual files are served through the `fs` overlay.
export function diagnoseInProcess(cwd: string, request: DiagnoseRequest): RawDiagnostic[] {
    const diagnostics: RawDiagnostic[] = []
    const api = new API({ cwd, fs: overlayFs(() => request.files) })
    try {
        const snapshot = api.updateSnapshot({ openFiles: request.open })
        for (const file of request.open) {
            const project = snapshot.getDefaultProjectForFile(file)
            if (project === undefined) continue
            const program = project.program
            const collected = [
                ...program.getSyntacticDiagnostics(file),
                ...program.getSemanticDiagnostics(file),
            ]
            for (const diagnostic of collected) {
                if (diagnostic.category !== DiagnosticCategory.Error) continue
                if (SUPPRESSED_CODES.has(diagnostic.code)) continue
                diagnostics.push({
                    file: diagnostic.fileName ?? file,
                    pos: diagnostic.pos,
                    code: diagnostic.code,
                    text: diagnostic.text,
                })
            }
        }
        return diagnostics
    } finally {
        api.close()
    }
}

// node subprocess entry (mirrors deriveSchema's `import.meta.main` bridge). Reads the virtual-file
// manifest from stdin.
if (import.meta.main && process.argv[2] === '--abide-diagnose') {
    const cwd = process.argv[3]
    if (cwd === undefined) {
        process.stderr.write('usage: node check.ts --abide-diagnose <cwd>  (manifest on stdin)\n')
        process.exit(2)
    }
    const request = JSON.parse(readFileSync(0, 'utf8')) as DiagnoseRequest
    const result = diagnoseInProcess(cwd, request)
    process.stdout.write(`${RESULT_MARKER}${JSON.stringify(result)}\n`)
}
